use super::*;

impl AcpConnection {
    #[allow(dead_code)]
    pub(super) async fn handle_fork_session(
        &self,
        cx: &ConnectionTo<Client>,
        args: ForkSessionRequest,
    ) -> Result<ForkSessionResponse, agent_client_protocol::Error> {
        let conversation_before_message_id =
            conversation_before_message_id_from_meta(args.meta.as_ref())?;
        let conversation_before_text = conversation_before_text_from_meta(args.meta.as_ref())?;
        let conversation_before = conversation_before_from_meta(args.meta.as_ref())?;
        let source_session_id = &*args.session_id.0;

        let source = self
            .services
            .session_manager
            .get_session(source_session_id, false)
            .await
            .internal_err()?;

        // Resolve and validate the effective cwd before copying anything, so a
        // bad request cannot leave a stray "(copy)" session in the store.
        let cwd = effective_session_cwd(self.session_cwd.as_deref(), &args.cwd);
        validate_absolute_cwd(&cwd)?;

        let mut base_name = source.name.trim();
        while let Some(stripped) = base_name.strip_suffix("(copy)") {
            base_name = stripped.trim();
        }
        let fork_name = if base_name.is_empty() {
            "(copy)".to_string()
        } else {
            format!("{base_name} (copy)")
        };

        let new_session = self
            .services
            .session_manager
            .copy_session(source_session_id, fork_name)
            .await
            .internal_err()?;
        let new_session_id = new_session.id.clone();

        // Cut by message id when the client sends one that this session knows.
        // Timestamps are stored in seconds and the store clamps them on insert,
        // so a timestamp alone cannot reliably identify the message the user
        // edited. When the id is unknown (the client kept a local one, or the
        // message was never persisted) fall back to the message text, which is
        // immune to both the clock drift and the second-granularity ties.
        let copied = self
            .services
            .session_manager
            .get_session(&new_session_id, true)
            .await
            .internal_err()?;

        let known_message_id = conversation_before_message_id.filter(|id| {
            copied
                .conversation
                .as_ref()
                .is_some_and(|conversation| {
                    conversation
                        .messages()
                        .iter()
                        .any(|message| message.id.as_deref() == Some(id.as_str()))
                })
        });

        let boundary_from_text = || {
            let wanted = conversation_before_text.as_deref()?;
            let timestamp = conversation_before?;
            copied
                .conversation
                .as_ref()?
                .messages()
                .iter()
                .rev()
                .find(|message| {
                    message.created <= timestamp
                        && matches!(message.role, rmcp::model::Role::User)
                        && message_text(message) == wanted
                })
                .and_then(|message| message.id.clone())
        };

        let by_id = known_message_id.is_some();
        let boundary = known_message_id.or_else(boundary_from_text);
        let by_text = !by_id && boundary.is_some();

        tracing::info!(
            session = %new_session_id,
            by_id,
            by_text,
            by_timestamp = boundary.is_none() && conversation_before.is_some(),
            "fork: resolving conversation cut"
        );

        if let Some(message_id) = boundary {
            self.services
                .session_manager
                .truncate_conversation_from_message(&new_session_id, &message_id)
                .await
                .internal_err()?;
        } else if let Some(conversation_before) = conversation_before {
            self.services
                .session_manager
                .truncate_conversation(&new_session_id, conversation_before)
                .await
                .internal_err()?;
        }

        let new_session = self
            .services
            .session_manager
            .get_session(&new_session_id, true)
            .await
            .internal_err()?;

        let mut goose_session = self
            .prepare_session_for_activation(new_session.clone(), cwd, args.mcp_servers, true)
            .await?;
        self.render_stored_recipe_template(&mut goose_session)
            .await?;

        let extension_results = self.prepare_acp_session(cx, &goose_session).await?;
        self.register_acp_session(goose_session.id.clone()).await;
        let provider = self
            .services
            .provider(&goose_session.id)
            .await
            .internal_err_ctx("Failed to get provider while forking ACP session")?;
        resume_saved_provider_session(&provider, goose_session.conversation.as_ref()).await;
        let effort_support = agent_thinking_effort_support(&self.services, &goose_session.id).await;

        let acp_session_id = SessionId::new(new_session_id.clone());
        let mut meta = session_meta(&goose_session);
        if let Ok(v) = serde_json::to_value(&extension_results) {
            meta.insert("extensionResults".to_string(), v);
        }

        let (mode_state, config_options) =
            build_session_setup_config(&self.provider_inventory, &goose_session, &effort_support)
                .await?;

        let mut response = ForkSessionResponse::new(acp_session_id.clone())
            .modes(mode_state)
            .meta(meta);

        if let Some(co) = config_options {
            response = response.config_options(co);
        }
        Ok(response)
    }
}

fn conversation_before_from_meta(
    meta: Option<&Meta>,
) -> Result<Option<i64>, agent_client_protocol::Error> {
    let Some(value) = meta.and_then(|meta| meta.get("conversationBefore")) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }

    value.as_i64().map(Some).ok_or_else(|| {
        agent_client_protocol::Error::invalid_params()
            .data("conversationBefore must be an integer timestamp")
    })
}

fn conversation_before_message_id_from_meta(
    meta: Option<&Meta>,
) -> Result<Option<String>, agent_client_protocol::Error> {
    let Some(value) = meta.and_then(|meta| meta.get("conversationBeforeMessageId")) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }

    value.as_str().map(|id| Some(id.to_string())).ok_or_else(|| {
        agent_client_protocol::Error::invalid_params()
            .data("conversationBeforeMessageId must be a string message id")
    })
}

fn conversation_before_text_from_meta(
    meta: Option<&Meta>,
) -> Result<Option<String>, agent_client_protocol::Error> {
    let Some(value) = meta.and_then(|meta| meta.get("conversationBeforeText")) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }

    value.as_str().map(|text| Some(text.to_string())).ok_or_else(|| {
        agent_client_protocol::Error::invalid_params()
            .data("conversationBeforeText must be a string")
    })
}

fn message_text(message: &crate::conversation::message::Message) -> String {
    let mut text = String::new();
    for block in &message.content {
        if let crate::conversation::message::MessageContentBlock::Text(content) = block {
            text.push_str(&content.text);
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta_with_conversation_before(value: serde_json::Value) -> Meta {
        let mut meta = Meta::new();
        meta.insert("conversationBefore".to_string(), value);
        meta
    }

    fn meta_with_conversation_before_message_id(value: serde_json::Value) -> Meta {
        let mut meta = Meta::new();
        meta.insert("conversationBeforeMessageId".to_string(), value);
        meta
    }

    fn meta_with_conversation_before_text(value: serde_json::Value) -> Meta {
        let mut meta = Meta::new();
        meta.insert("conversationBeforeText".to_string(), value);
        meta
    }

    #[test]
    fn conversation_before_message_id_from_meta_reads_message_id() {
        let meta = meta_with_conversation_before_message_id(serde_json::json!("msg_123"));

        assert_eq!(
            conversation_before_message_id_from_meta(Some(&meta)).unwrap(),
            Some("msg_123".to_string())
        );
        assert_eq!(
            conversation_before_message_id_from_meta(None).unwrap(),
            None
        );
        assert_eq!(
            conversation_before_message_id_from_meta(Some(&meta_with_conversation_before_message_id(
                serde_json::Value::Null
            )))
            .unwrap(),
            None
        );
    }

    #[test]
    fn conversation_before_message_id_from_meta_rejects_non_string() {
        for value in [
            serde_json::json!(1_718_000_000),
            serde_json::json!(true),
            serde_json::json!({ "id": "msg_123" }),
        ] {
            assert!(conversation_before_message_id_from_meta(Some(
                &meta_with_conversation_before_message_id(value)
            ))
            .is_err());
        }
    }

    #[test]
    fn conversation_before_text_from_meta_reads_text() {
        let meta = meta_with_conversation_before_text(serde_json::json!("hello there"));

        assert_eq!(
            conversation_before_text_from_meta(Some(&meta)).unwrap(),
            Some("hello there".to_string())
        );
        assert_eq!(
            conversation_before_text_from_meta(Some(&meta_with_conversation_before_text(
                serde_json::Value::Null
            )))
            .unwrap(),
            None
        );
        assert!(conversation_before_text_from_meta(Some(&meta_with_conversation_before_text(
            serde_json::json!(42)
        )))
        .is_err());
    }

    #[test]
    fn message_text_concatenates_text_blocks() {
        let message = crate::conversation::message::Message::user().with_text("hello world");

        assert_eq!(message_text(&message), "hello world");
    }

    #[test]
    fn conversation_before_from_meta_returns_none_when_absent() {
        assert_eq!(conversation_before_from_meta(None).unwrap(), None);
        assert_eq!(
            conversation_before_from_meta(Some(&Meta::new())).unwrap(),
            None
        );
    }

    #[test]
    fn conversation_before_from_meta_treats_null_as_absent() {
        let meta = meta_with_conversation_before(serde_json::Value::Null);

        assert_eq!(conversation_before_from_meta(Some(&meta)).unwrap(), None);
    }

    #[test]
    fn conversation_before_from_meta_reads_integer_timestamp() {
        let meta = meta_with_conversation_before(serde_json::json!(1_718_000_000));

        assert_eq!(
            conversation_before_from_meta(Some(&meta)).unwrap(),
            Some(1_718_000_000)
        );
    }

    #[test]
    fn conversation_before_from_meta_rejects_non_integer_timestamp() {
        for value in [
            serde_json::json!("1718000000"),
            serde_json::json!(1718000000.5),
            serde_json::json!(true),
            serde_json::json!({ "created": 1718000000 }),
        ] {
            assert!(
                conversation_before_from_meta(Some(&meta_with_conversation_before(value))).is_err()
            );
        }
    }
}

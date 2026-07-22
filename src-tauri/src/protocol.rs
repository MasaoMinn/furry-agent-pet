use std::fmt;

use serde::Serialize;
use serde_json::Value;

pub const MAX_TEXT_CHARS: usize = 1_000;
pub const MAX_LINE_BYTES: usize = 64 * 1_024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Idle,
    Thinking,
    Planning,
    Coding,
    Testing,
    Success,
    Error,
}

impl AgentState {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "idle" => Some(Self::Idle),
            "thinking" => Some(Self::Thinking),
            "planning" => Some(Self::Planning),
            "coding" => Some(Self::Coding),
            "testing" => Some(Self::Testing),
            "success" => Some(Self::Success),
            "error" => Some(Self::Error),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StateEvent {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub state: AgentState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    InvalidJson(String),
    InvalidFieldType(&'static str),
    InvalidType,
    UnknownState,
    FieldTooLong(&'static str),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidJson(error) => write!(formatter, "invalid JSON: {error}"),
            Self::InvalidFieldType(field) => {
                write!(formatter, "{field} has an invalid field type")
            }
            Self::InvalidType => formatter.write_str("event type must be state"),
            Self::UnknownState => formatter.write_str("event contains an unknown state"),
            Self::FieldTooLong(field) => {
                write!(formatter, "{field} exceeds {MAX_TEXT_CHARS} characters")
            }
        }
    }
}

impl std::error::Error for ProtocolError {}

pub fn parse_state_event(line: &[u8]) -> Result<StateEvent, ProtocolError> {
    let raw: Value = serde_json::from_slice(line)
        .map_err(|error| ProtocolError::InvalidJson(error.to_string()))?;
    let object = raw
        .as_object()
        .ok_or(ProtocolError::InvalidFieldType("event"))?;
    let event_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or(ProtocolError::InvalidFieldType("type"))?;

    if event_type != "state" {
        return Err(ProtocolError::InvalidType);
    }

    let raw_state = object
        .get("state")
        .and_then(Value::as_str)
        .ok_or(ProtocolError::InvalidFieldType("state"))?;
    let state = AgentState::parse(raw_state).ok_or(ProtocolError::UnknownState)?;
    let message = parse_optional_text(object.get("message"), "message")?;
    let file = parse_optional_text(object.get("file"), "file")?;

    Ok(StateEvent {
        event_type: "state",
        state,
        message,
        file,
    })
}

fn parse_optional_text(
    value: Option<&Value>,
    field: &'static str,
) -> Result<Option<String>, ProtocolError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value
        .as_str()
        .ok_or(ProtocolError::InvalidFieldType(field))?;
    if value.chars().count() > MAX_TEXT_CHARS {
        return Err(ProtocolError::FieldTooLong(field));
    }
    Ok(Some(value.to_owned()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    LineTooLong,
    Protocol(ProtocolError),
}

impl fmt::Display for DecodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LineTooLong => {
                write!(formatter, "IPC line exceeds {MAX_LINE_BYTES} bytes")
            }
            Self::Protocol(error) => error.fmt(formatter),
        }
    }
}

/// Incrementally decodes newline-delimited JSON from arbitrary byte chunks.
///
/// A decoder belongs to exactly one connection. If a line exceeds the bound,
/// it is discarded through its next newline so later valid events can recover.
pub struct JsonLinesDecoder {
    buffer: Vec<u8>,
    discarding_oversized_line: bool,
}

impl Default for JsonLinesDecoder {
    fn default() -> Self {
        Self {
            buffer: Vec::with_capacity(8 * 1_024),
            discarding_oversized_line: false,
        }
    }
}

impl JsonLinesDecoder {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<Result<StateEvent, DecodeError>> {
        let mut events = Vec::new();

        for &byte in chunk {
            if self.discarding_oversized_line {
                if byte == b'\n' {
                    self.discarding_oversized_line = false;
                }
                continue;
            }

            if byte == b'\n' {
                let mut line = std::mem::take(&mut self.buffer);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }

                if !line.iter().all(u8::is_ascii_whitespace) {
                    events.push(parse_state_event(&line).map_err(DecodeError::Protocol));
                }
                continue;
            }

            if self.buffer.len() == MAX_LINE_BYTES {
                self.buffer.clear();
                self.discarding_oversized_line = true;
                events.push(Err(DecodeError::LineTooLong));
                continue;
            }

            self.buffer.push(byte);
        }

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_EVENT: &str =
        r#"{"type":"state","state":"coding","message":"实现连接","file":"src/ipc.rs"}"#;

    #[test]
    fn parses_valid_event_and_ignores_unknown_fields() {
        let event = parse_state_event(
            r#"{"type":"state","state":"thinking","message":"分析中","future":true}"#.as_bytes(),
        )
        .expect("event should parse");

        assert_eq!(event.event_type, "state");
        assert_eq!(event.state, AgentState::Thinking);
        assert_eq!(event.message.as_deref(), Some("分析中"));
        assert_eq!(event.file, None);
    }

    #[test]
    fn rejects_invalid_json_and_unknown_state() {
        assert!(matches!(
            parse_state_event(br#"{"type":"state""#),
            Err(ProtocolError::InvalidJson(_))
        ));
        assert_eq!(
            parse_state_event(br#"{"type":"state","state":"sleeping"}"#),
            Err(ProtocolError::UnknownState)
        );
    }

    #[test]
    fn rejects_non_state_type_and_oversized_fields() {
        assert_eq!(
            parse_state_event(br#"{"type":"ping","state":"idle"}"#),
            Err(ProtocolError::InvalidType)
        );

        let oversized = "狐".repeat(MAX_TEXT_CHARS + 1);
        let line = serde_json::json!({
            "type": "state",
            "state": "coding",
            "message": oversized,
        })
        .to_string();
        assert_eq!(
            parse_state_event(line.as_bytes()),
            Err(ProtocolError::FieldTooLong("message"))
        );

        let oversized_file = "路".repeat(MAX_TEXT_CHARS + 1);
        let line = serde_json::json!({
            "type": "state",
            "state": "coding",
            "file": oversized_file,
        })
        .to_string();
        assert_eq!(
            parse_state_event(line.as_bytes()),
            Err(ProtocolError::FieldTooLong("file"))
        );
    }

    #[test]
    fn rejects_null_and_non_string_optional_fields() {
        assert_eq!(
            parse_state_event(br#"{"type":"state","state":"idle","message":null}"#),
            Err(ProtocolError::InvalidFieldType("message"))
        );
        assert_eq!(
            parse_state_event(br#"{"type":"state","state":"idle","file":12}"#),
            Err(ProtocolError::InvalidFieldType("file"))
        );
    }

    #[test]
    fn decodes_partial_and_sticky_packets_with_crlf_and_blank_lines() {
        let mut decoder = JsonLinesDecoder::default();
        assert!(decoder.push(&VALID_EVENT.as_bytes()[..21]).is_empty());

        let remainder = format!("{}\r\n\r\n{}\n", &VALID_EVENT[21..], VALID_EVENT);
        let events = decoder.push(remainder.as_bytes());

        assert_eq!(events.len(), 2);
        assert!(events.iter().all(Result::is_ok));
        assert_eq!(events[0].as_ref().unwrap().state, AgentState::Coding);
        assert_eq!(events[1].as_ref().unwrap().state, AgentState::Coding);
    }

    #[test]
    fn preserves_utf8_code_points_split_across_chunks() {
        let line = format!("{VALID_EVENT}\n");
        let bytes = line.as_bytes();
        let split = bytes
            .windows(3)
            .position(|window| window == "实".as_bytes())
            .expect("Chinese character should be present")
            + 1;

        let mut decoder = JsonLinesDecoder::default();
        assert!(decoder.push(&bytes[..split]).is_empty());
        let events = decoder.push(&bytes[split..]);

        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].as_ref().unwrap().message.as_deref(),
            Some("实现连接")
        );
    }

    #[test]
    fn drops_oversized_line_and_recovers_at_next_newline() {
        let mut decoder = JsonLinesDecoder::default();
        let oversized = vec![b'x'; MAX_LINE_BYTES + 32];
        let events = decoder.push(&oversized);
        assert_eq!(events, vec![Err(DecodeError::LineTooLong)]);

        let recovery = format!("\n{VALID_EVENT}\n");
        let events = decoder.push(recovery.as_bytes());
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].as_ref().unwrap().state, AgentState::Coding);
    }
}

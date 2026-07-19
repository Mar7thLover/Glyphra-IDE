//! Newline-delimited JSON framing helpers shared by the agent supervisor
//! and fixture unit tests.

/// Split a byte buffer into complete lines, leaving any trailing partial
/// line in `pending`. Lines keep their content without the trailing `\n`.
pub fn drain_lines(pending: &mut Vec<u8>, chunk: &[u8]) -> Vec<String> {
    pending.extend_from_slice(chunk);
    let mut lines = Vec::new();
    while let Some(idx) = pending.iter().position(|b| *b == b'\n') {
        let mut line = pending.drain(..=idx).collect::<Vec<u8>>();
        if line.last() == Some(&b'\n') {
            line.pop();
        }
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        match String::from_utf8(line) {
            Ok(text) if !text.is_empty() => lines.push(text),
            _ => {}
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_partial_chunks() {
        let mut pending = Vec::new();
        assert!(drain_lines(&mut pending, b"{\"a\":1").is_empty());
        let lines = drain_lines(&mut pending, b"}\n{\"b\":2}\n{\"c\":");
        assert_eq!(lines, vec![r#"{"a":1}"#, r#"{"b":2}"#]);
        assert_eq!(pending, b"{\"c\":");
        let rest = drain_lines(&mut pending, b"3}\n");
        assert_eq!(rest, vec![r#"{"c":3}"#]);
        assert!(pending.is_empty());
    }
}

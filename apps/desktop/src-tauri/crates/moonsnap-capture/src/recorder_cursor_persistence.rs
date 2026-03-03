//! Callback-based cursor persistence helper for recording finalization.

use crate::recorder_finalization::{should_persist_cursor_data, FinalizationPlan};

/// Persist cursor data only when finalization plan and runtime conditions require it.
///
/// Returns `Ok(true)` when persistence callback was executed.
pub fn maybe_persist_cursor_data<F, E>(
    plan: FinalizationPlan,
    has_cursor_data_path: bool,
    cursor_event_count: usize,
    mut persist: F,
) -> Result<bool, E>
where
    F: FnMut() -> Result<(), E>,
{
    if should_persist_cursor_data(plan, has_cursor_data_path, cursor_event_count) {
        persist()?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::maybe_persist_cursor_data;
    use crate::recorder_finalization::build_finalization_plan;

    #[test]
    fn calls_persist_when_required() {
        let plan = build_finalization_plan(false);
        let mut called = false;
        let result = maybe_persist_cursor_data(plan, true, 3, || {
            called = true;
            Ok::<(), String>(())
        });

        assert_eq!(result, Ok(true));
        assert!(called);
    }

    #[test]
    fn skips_persist_when_not_required() {
        let plan = build_finalization_plan(true);
        let mut called = false;
        let result = maybe_persist_cursor_data(plan, true, 3, || {
            called = true;
            Ok::<(), String>(())
        });

        assert_eq!(result, Ok(false));
        assert!(!called);
    }

    #[test]
    fn propagates_persist_error() {
        let plan = build_finalization_plan(false);
        let result = maybe_persist_cursor_data(plan, true, 3, || {
            Err::<(), String>("write failed".to_string())
        });

        assert_eq!(result, Err("write failed".to_string()));
    }
}

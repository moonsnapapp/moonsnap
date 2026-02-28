//! Async callback-driven export loop orchestration.

use std::future::Future;
use std::pin::Pin;
use tokio::sync::mpsc;

/// Per-item directive returned by callback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportLoopDirective {
    Continue,
    Stop,
}

/// Terminal reason for export loop completion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportLoopExit {
    InputExhausted,
    Cancelled,
    StoppedByCallback,
}

/// Run a decode-consume loop with cancel checks and callback-driven control.
///
/// The caller provides per-item async processing via `on_item`, and decides
/// whether to continue or stop by returning `ExportLoopDirective`.
pub async fn run_export_loop<T, IsCancelled, OnItem, OnItemFuture>(
    decode_rx: &mut mpsc::Receiver<T>,
    mut is_cancelled: IsCancelled,
    mut on_item: OnItem,
) -> Result<ExportLoopExit, String>
where
    IsCancelled: FnMut() -> bool,
    OnItem: FnMut(T) -> OnItemFuture,
    OnItemFuture: Future<Output = Result<ExportLoopDirective, String>>,
{
    loop {
        if is_cancelled() {
            return Ok(ExportLoopExit::Cancelled);
        }

        let Some(item) = decode_rx.recv().await else {
            return Ok(ExportLoopExit::InputExhausted);
        };

        match on_item(item).await? {
            ExportLoopDirective::Continue => {},
            ExportLoopDirective::Stop => return Ok(ExportLoopExit::StoppedByCallback),
        }
    }
}

/// Run a decode-consume loop with explicit mutable context.
///
/// This variant allows async per-item callbacks to mutate shared loop state
/// without capturing mutable outer variables in the callback closure.
pub async fn run_export_loop_with_context<T, Ctx, IsCancelled, OnItem>(
    decode_rx: &mut mpsc::Receiver<T>,
    ctx: &mut Ctx,
    mut is_cancelled: IsCancelled,
    mut on_item: OnItem,
) -> Result<ExportLoopExit, String>
where
    IsCancelled: FnMut(&Ctx) -> bool,
    OnItem: for<'a> FnMut(
        &'a mut Ctx,
        T,
    ) -> Pin<
        Box<dyn Future<Output = Result<ExportLoopDirective, String>> + Send + 'a>,
    >,
{
    loop {
        if is_cancelled(ctx) {
            return Ok(ExportLoopExit::Cancelled);
        }

        let Some(item) = decode_rx.recv().await else {
            return Ok(ExportLoopExit::InputExhausted);
        };

        match on_item(ctx, item).await? {
            ExportLoopDirective::Continue => {},
            ExportLoopDirective::Stop => return Ok(ExportLoopExit::StoppedByCallback),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loop_stops_when_callback_requests_stop() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let (tx, mut rx) = mpsc::channel(8);
            tx.send(1).await.unwrap();
            tx.send(2).await.unwrap();
            drop(tx);

            let mut seen = Vec::new();
            let exit = run_export_loop(
                &mut rx,
                || false,
                |item| {
                    seen.push(item);
                    async move {
                        if item == 2 {
                            Ok(ExportLoopDirective::Stop)
                        } else {
                            Ok(ExportLoopDirective::Continue)
                        }
                    }
                },
            )
            .await
            .unwrap();

            assert_eq!(exit, ExportLoopExit::StoppedByCallback);
            assert_eq!(seen, vec![1, 2]);
        });
    }

    #[test]
    fn loop_stops_when_cancelled() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let (_tx, mut rx) = mpsc::channel::<u32>(8);
            let exit = run_export_loop(
                &mut rx,
                || true,
                |_| async { Ok(ExportLoopDirective::Continue) },
            )
            .await
            .unwrap();
            assert_eq!(exit, ExportLoopExit::Cancelled);
        });
    }

    #[test]
    fn loop_stops_when_input_exhausted() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let (tx, mut rx) = mpsc::channel::<u32>(8);
            drop(tx);
            // Drop sender immediately => exhausted.
            let exit = run_export_loop(
                &mut rx,
                || false,
                |_| async { Ok(ExportLoopDirective::Continue) },
            )
            .await
            .unwrap();
            assert_eq!(exit, ExportLoopExit::InputExhausted);
        });
    }

    #[test]
    fn loop_with_context_mutates_state() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let (tx, mut rx) = mpsc::channel(8);
            tx.send(1u32).await.unwrap();
            tx.send(2u32).await.unwrap();
            drop(tx);

            let mut sum = 0u32;
            let exit = run_export_loop_with_context(
                &mut rx,
                &mut sum,
                |_| false,
                |ctx, item| {
                    Box::pin(async move {
                        *ctx += item;
                        if *ctx >= 3 {
                            Ok(ExportLoopDirective::Stop)
                        } else {
                            Ok(ExportLoopDirective::Continue)
                        }
                    })
                },
            )
            .await
            .unwrap();

            assert_eq!(exit, ExportLoopExit::StoppedByCallback);
            assert_eq!(sum, 3);
        });
    }
}

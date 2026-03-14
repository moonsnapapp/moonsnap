//! Caption remapping helpers for edited timeline exports.

use moonsnap_project_types::captions::{CaptionSegment, CaptionWord};
use moonsnap_project_types::video_project::TimelineState;

const CAPTION_TIMELINE_EPSILON: f32 = 0.0005;

fn merge_adjacent_word_slices(words: Vec<CaptionWord>) -> Vec<CaptionWord> {
    let mut merged: Vec<CaptionWord> = Vec::with_capacity(words.len());

    for word in words {
        if let Some(previous) = merged.last_mut() {
            if previous.text == word.text
                && (previous.end - word.start).abs() < CAPTION_TIMELINE_EPSILON
            {
                previous.end = word.end;
                continue;
            }
        }

        merged.push(word);
    }

    merged
}

/// Remap caption segments from source time to timeline time.
/// Filters out captions that fall entirely within deleted segments.
/// For captions that partially overlap kept segments, clips them to segment boundaries and
/// collapses the kept slices back into a single continuous timeline segment.
pub fn remap_captions_to_timeline(
    captions: &[CaptionSegment],
    timeline: &TimelineState,
) -> Vec<CaptionSegment> {
    // If no segments (no cuts), captions are already in source order and only
    // need clipping to in/out points plus offsetting to timeline-zero.
    if timeline.segments.is_empty() {
        return captions
            .iter()
            .filter_map(|cap| {
                let start_ms = (cap.start * 1000.0) as u64;
                let end_ms = (cap.end * 1000.0) as u64;

                if end_ms <= timeline.in_point || start_ms >= timeline.out_point {
                    return None;
                }

                let clipped_start_ms = start_ms.max(timeline.in_point);
                let clipped_end_ms = end_ms.min(timeline.out_point);
                let timeline_start = (clipped_start_ms - timeline.in_point) as f32 / 1000.0;
                let timeline_end = (clipped_end_ms - timeline.in_point) as f32 / 1000.0;

                let remapped_words: Vec<CaptionWord> = cap
                    .words
                    .iter()
                    .filter_map(|word| {
                        let word_start_ms = (word.start * 1000.0) as u64;
                        let word_end_ms = (word.end * 1000.0) as u64;

                        if word_end_ms <= timeline.in_point || word_start_ms >= timeline.out_point {
                            return None;
                        }

                        let w_start = word_start_ms.max(timeline.in_point);
                        let w_end = word_end_ms.min(timeline.out_point);

                        Some(CaptionWord {
                            text: word.text.clone(),
                            start: (w_start - timeline.in_point) as f32 / 1000.0,
                            end: (w_end - timeline.in_point) as f32 / 1000.0,
                        })
                    })
                    .collect();
                let text = if remapped_words.is_empty() {
                    cap.text.clone()
                } else {
                    remapped_words
                        .iter()
                        .map(|word| word.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                };

                Some(CaptionSegment {
                    id: cap.id.clone(),
                    start: timeline_start,
                    end: timeline_end,
                    text,
                    words: remapped_words,
                })
            })
            .collect();
    }

    // With segments: remap each caption through all kept source windows and merge the
    // surviving slices back into one segment on the edited timeline.
    let mut remapped: Vec<CaptionSegment> = Vec::new();

    for cap in captions {
        let cap_start_ms = (cap.start * 1000.0) as u64;
        let cap_end_ms = (cap.end * 1000.0) as u64;

        let mut remapped_start: Option<f32> = None;
        let mut remapped_end: Option<f32> = None;
        let mut remapped_words: Vec<CaptionWord> = Vec::new();
        let mut timeline_offset = 0u64;

        for seg in &timeline.segments {
            if cap_end_ms > seg.source_start_ms && cap_start_ms < seg.source_end_ms {
                let clipped_start_ms = cap_start_ms.max(seg.source_start_ms);
                let clipped_end_ms = cap_end_ms.min(seg.source_end_ms);

                let timeline_start =
                    (timeline_offset + (clipped_start_ms - seg.source_start_ms)) as f32 / 1000.0;
                let timeline_end =
                    (timeline_offset + (clipped_end_ms - seg.source_start_ms)) as f32 / 1000.0;

                if remapped_start.is_none() {
                    remapped_start = Some(timeline_start);
                }
                remapped_end = Some(timeline_end);

                remapped_words.extend(cap.words.iter().filter_map(|word| {
                    let word_start_ms = (word.start * 1000.0) as u64;
                    let word_end_ms = (word.end * 1000.0) as u64;

                    if word_end_ms > seg.source_start_ms && word_start_ms < seg.source_end_ms {
                        let w_start = word_start_ms.max(seg.source_start_ms);
                        let w_end = word_end_ms.min(seg.source_end_ms);

                        if w_end > w_start {
                            Some(CaptionWord {
                                text: word.text.clone(),
                                start: (timeline_offset + (w_start - seg.source_start_ms)) as f32
                                    / 1000.0,
                                end: (timeline_offset + (w_end - seg.source_start_ms)) as f32
                                    / 1000.0,
                            })
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }));
            }

            timeline_offset += seg.source_end_ms - seg.source_start_ms;
        }

        if let (Some(start), Some(end)) = (remapped_start, remapped_end) {
            if end > start {
                let merged_words = merge_adjacent_word_slices(remapped_words);
                let text = if merged_words.is_empty() {
                    cap.text.clone()
                } else {
                    merged_words
                        .iter()
                        .map(|word| word.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                };

                remapped.push(CaptionSegment {
                    id: cap.id.clone(),
                    start,
                    end,
                    text,
                    words: merged_words,
                });
            }
        }
    }

    remapped
}

#[cfg(test)]
mod tests {
    use super::*;
    use moonsnap_project_types::video_project::TrimSegment;

    fn caption(id: &str, start: f32, end: f32, text: &str) -> CaptionSegment {
        CaptionSegment {
            id: id.to_string(),
            start,
            end,
            text: text.to_string(),
            words: vec![CaptionWord {
                text: text.to_string(),
                start,
                end,
            }],
        }
    }

    #[test]
    fn clips_and_offsets_when_no_segments() {
        let timeline = TimelineState {
            duration_ms: 10_000,
            in_point: 1_000,
            out_point: 5_000,
            speed: 1.0,
            segments: Vec::new(),
        };
        let input = vec![
            caption("a", 0.5, 1.2, "hello"),
            caption("b", 1.5, 2.0, "world"),
            caption("c", 5.1, 5.5, "skip"),
        ];

        let out = remap_captions_to_timeline(&input, &timeline);
        assert_eq!(out.len(), 2);

        assert_eq!(out[0].id, "a");
        assert!((out[0].start - 0.0).abs() < f32::EPSILON);
        assert!((out[0].end - 0.2).abs() < 0.0001);

        assert_eq!(out[1].id, "b");
        assert!((out[1].start - 0.5).abs() < 0.0001);
        assert!((out[1].end - 1.0).abs() < 0.0001);
    }

    #[test]
    fn remaps_and_merges_across_trim_segments() {
        let timeline = TimelineState {
            duration_ms: 10_000,
            in_point: 0,
            out_point: 10_000,
            speed: 1.0,
            segments: vec![
                TrimSegment {
                    id: "s1".to_string(),
                    source_start_ms: 1_000,
                    source_end_ms: 2_000,
                },
                TrimSegment {
                    id: "s2".to_string(),
                    source_start_ms: 3_000,
                    source_end_ms: 4_000,
                },
            ],
        };
        let input = vec![caption("cap", 1.5, 3.5, "segment")];

        let out = remap_captions_to_timeline(&input, &timeline);
        assert_eq!(out.len(), 1);

        assert_eq!(out[0].id, "cap");
        assert!((out[0].start - 0.5).abs() < 0.0001);
        assert!((out[0].end - 1.5).abs() < 0.0001);
        assert_eq!(out[0].words.len(), 1);
        assert!((out[0].words[0].start - 0.5).abs() < 0.0001);
        assert!((out[0].words[0].end - 1.5).abs() < 0.0001);
    }

    #[test]
    fn removes_words_that_only_exist_in_deleted_regions() {
        let timeline = TimelineState {
            duration_ms: 10_000,
            in_point: 0,
            out_point: 10_000,
            speed: 1.0,
            segments: vec![
                TrimSegment {
                    id: "s1".to_string(),
                    source_start_ms: 1_000,
                    source_end_ms: 2_000,
                },
                TrimSegment {
                    id: "s2".to_string(),
                    source_start_ms: 3_000,
                    source_end_ms: 4_000,
                },
            ],
        };
        let input = vec![CaptionSegment {
            id: "cap".to_string(),
            start: 1.5,
            end: 3.5,
            text: "alpha beta gamma".to_string(),
            words: vec![
                CaptionWord {
                    text: "alpha".to_string(),
                    start: 1.6,
                    end: 1.9,
                },
                CaptionWord {
                    text: "beta".to_string(),
                    start: 2.1,
                    end: 2.4,
                },
                CaptionWord {
                    text: "gamma".to_string(),
                    start: 3.1,
                    end: 3.4,
                },
            ],
        }];

        let out = remap_captions_to_timeline(&input, &timeline);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "alpha gamma");
        assert_eq!(out[0].words.len(), 2);
        assert!((out[0].words[0].start - 0.6).abs() < 0.0001);
        assert!((out[0].words[0].end - 0.9).abs() < 0.0001);
        assert!((out[0].words[1].start - 1.1).abs() < 0.0001);
        assert!((out[0].words[1].end - 1.4).abs() < 0.0001);
    }
}

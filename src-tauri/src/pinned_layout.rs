use serde::Serialize;

pub const PARENT_COLLAPSED_WIDTH: f64 = 210.0;
pub const PARENT_COLLAPSED_HEIGHT: f64 = 46.0;
const PARENT_EXPANDED_WIDTH: f64 = 420.0;
const PARENT_EXPANDED_HEIGHT: f64 = 60.0;
const CHILD_COLLAPSED_WIDTH: f64 = 180.0;
const CHILD_EXPANDED_WIDTH: f64 = 380.0;
const GROUP_GAP: f64 = 28.0;
const CHILD_GAP: f64 = 4.0;
const MARGIN: f64 = 18.0;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug)]
pub struct Stack {
    pub slot: String,
    pub child_count: usize,
    pub expanded: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Placement {
    pub slot: String,
    pub expanded: bool,
    pub parent: Frame,
    pub subtasks: Option<Frame>,
}

pub fn child_height(count: usize, expanded: bool) -> f64 {
    let shown = count.min(if expanded { 5 } else { 3 });
    if shown == 0 {
        return 0.0;
    }
    shown as f64 * if expanded { 54.0 } else { 46.0 } + shown.saturating_sub(1) as f64 * 8.0 + 8.0
}

pub fn place_stack(stack: &Stack, right: f64, y: f64, available_height: f64) -> Placement {
    let (width, height) = if stack.expanded {
        (PARENT_EXPANDED_WIDTH, PARENT_EXPANDED_HEIGHT)
    } else {
        (PARENT_COLLAPSED_WIDTH, PARENT_COLLAPSED_HEIGHT)
    };
    let parent = Frame {
        x: right - width,
        y,
        width,
        height,
    };
    let subtasks = (stack.child_count > 0).then(|| {
        let width = if stack.expanded {
            CHILD_EXPANDED_WIDTH
        } else {
            CHILD_COLLAPSED_WIDTH
        };
        Frame {
            x: right - width,
            y: y + height + CHILD_GAP,
            width,
            height: child_height(stack.child_count, stack.expanded)
                .min((available_height - height - CHILD_GAP).max(0.0)),
        }
    });
    Placement {
        slot: stack.slot.clone(),
        expanded: stack.expanded,
        parent,
        subtasks,
    }
}

// Lay out complete parent/child groups. A group never straddles columns, and
// vacant window slots do not consume vertical space. Later groups move together
// when any earlier group grows, shrinks, or is removed.
pub fn layout(stacks: &[Stack], work: Frame) -> Vec<Placement> {
    let mut placements = Vec::new();
    // If more columns would leave the screen, shorten the scrollable child
    // viewports before giving up screen space to another column.
    for child_limit in [usize::MAX, 3, 2, 1] {
        placements = layout_with_child_limit(stacks, work, child_limit);
        if placements.iter().all(|p| p.parent.x >= work.x) {
            return placements;
        }
    }
    placements
}

fn layout_with_child_limit(stacks: &[Stack], work: Frame, child_limit: usize) -> Vec<Placement> {
    let top = work.y + MARGIN;
    let bottom = work.y + work.height - MARGIN;
    let available = (bottom - top).max(PARENT_EXPANDED_HEIGHT);
    let mut placements = Vec::with_capacity(stacks.len());
    let mut right = work.x + work.width;
    let mut y = top;
    let mut column_width: f64 = 0.0;

    for stack in stacks {
        let place = |right, y| {
            let mut placement = place_stack(stack, right, y, available);
            if let Some(child) = placement.subtasks.as_mut() {
                child.height = child.height.min(child_height(
                    stack.child_count.min(child_limit),
                    stack.expanded,
                ));
            }
            placement
        };
        let mut placement = place(right, y);
        let group_height = placement.subtasks.map_or(placement.parent.height, |child| {
            child.y + child.height - placement.parent.y
        });
        if y > top && y + group_height > bottom {
            right -= column_width + GROUP_GAP;
            y = top;
            column_width = 0.0;
            placement = place(right, y);
        }
        column_width = column_width.max(placement.parent.width);
        y += group_height + GROUP_GAP;
        placements.push(placement);
    }
    placements
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stack(slot: &str, child_count: usize, expanded: bool) -> Stack {
        Stack {
            slot: slot.into(),
            child_count,
            expanded,
        }
    }

    fn work() -> Frame {
        Frame {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1040.0,
        }
    }

    fn assert_no_overlap(placements: &[Placement]) {
        let frames: Vec<_> = placements
            .iter()
            .flat_map(|p| std::iter::once(p.parent).chain(p.subtasks))
            .collect();
        for (i, a) in frames.iter().enumerate() {
            for b in &frames[i + 1..] {
                assert!(
                    a.x + a.width <= b.x
                        || b.x + b.width <= a.x
                        || a.y + a.height <= b.y
                        || b.y + b.height <= a.y,
                    "overlap: {a:?} and {b:?}"
                );
            }
        }
    }

    #[test]
    fn first_parent_children_leave_room_for_every_following_parent() {
        let result = layout(
            &[
                stack("0", 2, false),
                stack("1", 0, false),
                stack("2", 0, false),
            ],
            work(),
        );
        assert_no_overlap(&result);
        assert_eq!(
            result[1].parent.y,
            result[0].subtasks.unwrap().y + 108.0 + GROUP_GAP
        );
    }

    #[test]
    fn adding_children_and_hover_expansion_reflow_existing_groups() {
        for count in 0..=8 {
            for expanded in [false, true] {
                let result = layout(
                    &[
                        stack("0", count, expanded),
                        stack("1", 2, false),
                        stack("2", 1, false),
                    ],
                    work(),
                );
                assert_no_overlap(&result);
            }
        }
    }

    #[test]
    fn removal_and_reused_slots_do_not_leave_stale_spacing() {
        let result = layout(&[stack("0", 0, false), stack("4", 2, false)], work());
        assert_eq!(
            result[1].parent.y,
            MARGIN + PARENT_COLLAPSED_HEIGHT + GROUP_GAP
        );
        assert_no_overlap(&result);
    }

    #[test]
    fn full_column_moves_whole_groups_left_instead_of_clamping_them_together_at_bottom() {
        let stacks: Vec<_> = (0..10).map(|i| stack(&i.to_string(), 3, i == 0)).collect();
        let result = layout(
            &stacks,
            Frame {
                height: 720.0,
                ..work()
            },
        );
        assert_no_overlap(&result);
        assert!(result
            .iter()
            .any(|p| p.parent.x + p.parent.width < work().width));
        for placement in result {
            let bottom = placement
                .subtasks
                .map_or(placement.parent.y + placement.parent.height, |c| {
                    c.y + c.height
                });
            assert!(bottom <= 720.0 - MARGIN);
        }
    }

    #[test]
    fn negative_monitor_coordinates_and_small_work_areas_keep_children_inside_the_group() {
        let work = Frame {
            x: -1920.0,
            y: -300.0,
            width: 1920.0,
            height: 320.0,
        };
        let result = layout(&[stack("0", 20, true), stack("1", 0, false)], work);
        assert_no_overlap(&result);
        assert!(
            result[0].subtasks.unwrap().y + result[0].subtasks.unwrap().height
                <= work.y + work.height - MARGIN
        );
    }

    #[test]
    fn many_child_groups_use_scrollable_viewports_to_fit_a_small_screen() {
        let stacks: Vec<_> = (0..10).map(|i| stack(&i.to_string(), 20, i == 0)).collect();
        let work = Frame {
            width: 1280.0,
            height: 560.0,
            ..work()
        };
        let result = layout(&stacks, work);
        assert_no_overlap(&result);
        for group in result {
            assert!(group.parent.x >= work.x);
            assert!(
                group.subtasks.unwrap().y + group.subtasks.unwrap().height
                    <= work.y + work.height - MARGIN
            );
        }
    }
}

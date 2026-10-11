use tauri::{PhysicalPosition, PhysicalSize};

// Logical pixels: match the CSS width regardless of the monitor's DPI.
pub const WIDTH: f64 = 420.0;
pub const MIN_HEIGHT: f64 = 260.0;
const MARGIN: f64 = 16.0;
const ROW_HEIGHT: f64 = 84.0;
const MAX_VISIBLE_ITEMS: usize = 3;

pub fn frame(
    origin: PhysicalPosition<i32>,
    work_area: PhysicalSize<u32>,
    scale: f64,
    item_count: usize,
) -> (PhysicalPosition<f64>, PhysicalSize<f64>) {
    let extra_rows = item_count.clamp(1, MAX_VISIBLE_ITEMS) - 1;
    let height = MIN_HEIGHT + extra_rows as f64 * ROW_HEIGHT;
    let margin = MARGIN * scale;
    let width = (WIDTH * scale).min((work_area.width as f64 - 2.0 * margin).max(1.0));
    let height = (height * scale).min((work_area.height as f64 - 2.0 * margin).max(1.0));

    (
        PhysicalPosition::new(
            origin.x as f64 + (work_area.width as f64 - width - margin).max(0.0),
            origin.y as f64 + (work_area.height as f64 - height - margin).max(0.0),
        ),
        PhysicalSize::new(width, height),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_same_logical_size_and_margin_at_different_monitor_scales() {
        for (resolution, scale) in [
            ((1920, 1080), 1.0),
            ((2560, 1440), 1.25),
            ((3840, 2160), 1.5),
            ((3840, 2160), 2.0),
        ] {
            let area = PhysicalSize::new(resolution.0, resolution.1);
            let (position, size) = frame(PhysicalPosition::new(0, 0), area, scale, 1);
            assert_eq!(size.width / scale, WIDTH);
            assert_eq!(size.height / scale, MIN_HEIGHT);
            assert_eq!(
                (area.width as f64 - position.x - size.width) / scale,
                MARGIN
            );
            assert_eq!(
                (area.height as f64 - position.y - size.height) / scale,
                MARGIN
            );
        }
    }

    #[test]
    fn anchors_to_the_work_area_on_a_monitor_with_negative_coordinates() {
        let (position, size) = frame(
            PhysicalPosition::new(-2560, -1440),
            PhysicalSize::new(2560, 1400),
            1.25,
            1,
        );
        assert_eq!(position.x + size.width, -20.0);
        assert_eq!(position.y + size.height, -60.0);
    }

    #[test]
    fn grows_for_grouped_reminders_and_caps_the_height_for_scrollable_lists() {
        let size_for = |count| {
            frame(
                PhysicalPosition::new(0, 0),
                PhysicalSize::new(1920, 1080),
                1.0,
                count,
            )
            .1
        };
        assert_eq!(size_for(0).height, 260.0);
        assert_eq!(size_for(1).height, 260.0);
        assert_eq!(size_for(2).height, 344.0);
        assert_eq!(size_for(10).height, 428.0);
        assert_eq!(size_for(10).width, size_for(1).width);
    }

    #[test]
    fn fits_inside_a_small_work_area() {
        let (position, size) = frame(
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(480, 320),
            1.5,
            10,
        );
        assert_eq!(size, PhysicalSize::new(432.0, 272.0));
        assert_eq!(position, PhysicalPosition::new(24.0, 24.0));
    }
}

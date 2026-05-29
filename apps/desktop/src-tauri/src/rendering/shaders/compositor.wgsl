struct Uniforms {
    video_size: vec4<f32>,      // width, height, 0, 0
    output_size: vec4<f32>,     // width, height, 0, 0
    zoom: vec4<f32>,            // scale, center_x, center_y, 0
    time_flags: vec4<f32>,      // time_ms, flags, 0, 0
    webcam_rect: vec4<f32>,     // x, y, width, height (normalized 0-1)
    webcam_params: vec4<f32>,   // shape(0=none,1=circle,2=squircle,3=rounded), shadow, mirror, radius
    webcam_shadow: vec4<f32>,   // shadow_size, shadow_opacity, shadow_blur, 0
    webcam_tex_size: vec4<f32>, // texture width, height, aspect_ratio, 0
    // Video frame styling
    frame_bounds: vec4<f32>,    // x, y, width, height in pixels (padded frame area)
    frame_rounding: vec4<f32>,  // rounding_px, rounding_type (0=rounded, 1=squircle), 0, 0
    frame_shadow: vec4<f32>,    // enabled, size, opacity, blur
    frame_border: vec4<f32>,    // enabled, width, opacity, 0
    border_color: vec4<f32>,    // r, g, b, a (linear space)
    zoom_motion_blur: vec4<f32>, // directional_px, dir_x, dir_y, radial_px
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var video_texture: texture_2d<f32>;
@group(0) @binding(2) var video_sampler: sampler;
@group(0) @binding(3) var webcam_texture: texture_2d<f32>;
@group(0) @binding(4) var webcam_sampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    var uvs = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(2.0, 1.0),
        vec2<f32>(0.0, -1.0)
    );

    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    output.uv = uvs[vertex_index];
    return output;
}

// sRGB <-> Linear conversion for CSS-compatible blending
// CSS blends colors in sRGB space, so we convert to sRGB, blend, then convert back
fn linear_to_srgb(c: f32) -> f32 {
    if (c <= 0.0031308) {
        return c * 12.92;
    }
    return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

fn srgb_to_linear(c: f32) -> f32 {
    if (c <= 0.04045) {
        return c / 12.92;
    }
    return pow((c + 0.055) / 1.055, 2.4);
}

fn linear_to_srgb_vec3(c: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(linear_to_srgb(c.x), linear_to_srgb(c.y), linear_to_srgb(c.z));
}

fn srgb_to_linear_vec3(c: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(srgb_to_linear(c.x), srgb_to_linear(c.y), srgb_to_linear(c.z));
}

// Superellipse norm for squircle (iOS-style rounded corners)
// Power of 4.0 gives the classic squircle shape
fn superellipse_norm(p: vec2<f32>, power: f32) -> f32 {
    let x = pow(abs(p.x), power);
    let y = pow(abs(p.y), power);
    return pow(x + y, 1.0 / power);
}

// Signed distance function for rounded rectangle with configurable corner style
fn sdf_rounded_rect_styled(p: vec2<f32>, half_size: vec2<f32>, radius: f32, rounding_type: f32) -> f32 {
    let q = abs(p) - half_size + vec2<f32>(radius);
    let outside = max(q, vec2<f32>(0.0));

    // rounding_type: 0 = standard rounded, 1 = squircle
    var outside_len: f32;
    if (rounding_type > 0.5) {
        // Squircle (superellipse with power 4)
        outside_len = superellipse_norm(outside, 4.0);
    } else {
        // Standard rounded corners
        outside_len = length(outside);
    }

    return outside_len + min(max(q.x, q.y), 0.0) - radius;
}

// Signed distance function for circle
fn sdf_circle(p: vec2<f32>, radius: f32) -> f32 {
    return length(p) - radius;
}

// Signed distance function for squircle (superellipse)
fn sdf_squircle(p: vec2<f32>, radius: f32) -> f32 {
    return superellipse_norm(p, 4.0) * radius - radius;
}

// Signed distance function for rounded rectangle
fn sdf_rounded_rect(p: vec2<f32>, half_size: vec2<f32>, radius: f32) -> f32 {
    let d = abs(p) - half_size + vec2<f32>(radius);
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0) - radius;
}

// Calculate SDF based on shape type (for webcam)
fn webcam_sdf(p: vec2<f32>, half_size: vec2<f32>, shape: f32, corner_radius: f32) -> f32 {
    let radius = min(half_size.x, half_size.y);
    let normalized_p = p / radius;

    if (shape < 1.5) {
        return sdf_circle(normalized_p, 1.0) * radius;
    } else if (shape < 2.5) {
        return sdf_squircle(normalized_p, 1.0) * radius;
    } else {
        return sdf_rounded_rect(p, half_size, corner_radius);
    }
}

fn sample_zoom_motion_blur(video_uv: vec2<f32>, zoom_center: vec2<f32>, frame_half_size: vec2<f32>) -> vec4<f32> {
    let directional_px = uniforms.zoom_motion_blur.x;
    let direction = uniforms.zoom_motion_blur.yz;
    let radial_px = uniforms.zoom_motion_blur.w;
    let max_blur_px = max(directional_px, radial_px);

    if (max_blur_px <= 0.01) {
        return textureSample(video_texture, video_sampler, video_uv);
    }

    let frame_size = max(frame_half_size * 2.0, vec2<f32>(1.0));
    let dir_uv = direction * directional_px / frame_size;
    let radial_dir = normalize(video_uv - zoom_center + vec2<f32>(0.0001, 0.0001));
    let radial_uv = radial_dir * radial_px / frame_size;
    let sample_step = dir_uv + radial_uv;

    // 9-tap symmetric kernel with gaussian-like weights. More taps + smaller
    // inter-sample steps keep the smear smooth even at small blur radii.
    var color = textureSample(video_texture, video_sampler, clamp(video_uv, vec2<f32>(0.0), vec2<f32>(1.0))) * 0.18;
    color += textureSample(video_texture, video_sampler, clamp(video_uv - sample_step * 0.25, vec2<f32>(0.0), vec2<f32>(1.0))) * 0.16;
    color += textureSample(video_texture, video_sampler, clamp(video_uv + sample_step * 0.25, vec2<f32>(0.0), vec2<f32>(1.0))) * 0.16;
    color += textureSample(video_texture, video_sampler, clamp(video_uv - sample_step * 0.50, vec2<f32>(0.0), vec2<f32>(1.0))) * 0.13;
    color += textureSample(video_texture, video_sampler, clamp(video_uv + sample_step * 0.50, vec2<f32>(0.0), vec2<f32>(1.0))) * 0.13;
    color += textureSample(video_texture, video_sampler, clamp(video_uv - sample_step * 0.75, vec2<f32>(0.0), vec2<f32>(1.0))) * 0.09;
    color += textureSample(video_texture, video_sampler, clamp(video_uv + sample_step * 0.75, vec2<f32>(0.0), vec2<f32>(1.0))) * 0.09;
    color += textureSample(video_texture, video_sampler, clamp(video_uv - sample_step, vec2<f32>(0.0), vec2<f32>(1.0))) * 0.03;
    color += textureSample(video_texture, video_sampler, clamp(video_uv + sample_step, vec2<f32>(0.0), vec2<f32>(1.0))) * 0.03;
    return color;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let pixel_pos = input.uv * uniforms.output_size.xy;

    // Frame bounds and styling (base values before zoom)
    let frame_pos = uniforms.frame_bounds.xy;
    let frame_size = uniforms.frame_bounds.zw;
    let base_frame_center = frame_pos + frame_size * 0.5;
    let base_half_size = frame_size * 0.5;

    let base_rounding = uniforms.frame_rounding.x;
    let rounding_type = uniforms.frame_rounding.y;

    // Single shadow value (0-100) - same as webcam for simplicity
    let shadow_value = uniforms.frame_shadow.x;
    let shadow_enabled = shadow_value > 0.0;

    let border_enabled = uniforms.frame_border.x > 0.5;
    let base_border_width = uniforms.frame_border.y;
    // border_opacity not used - Cap uses border_color.w directly

    // Zoom parameters
    let zoom_scale = uniforms.zoom.x;
    let zoom_center = vec2<f32>(uniforms.zoom.y, uniforms.zoom.z);

    // Apply zoom to frame geometry (CSS-style: scale the entire frame+border+shadow)
    // When zoom > 1, the frame appears larger, so we scale all dimensions
    var frame_half_size = base_half_size;
    var rounding_px = base_rounding;
    var border_width = base_border_width;
    var frame_center = base_frame_center;

    if (zoom_scale > 1.0) {
        // Scale frame dimensions by zoom factor
        frame_half_size = base_half_size * zoom_scale;
        rounding_px = base_rounding * zoom_scale;
        border_width = base_border_width * zoom_scale;

        // Offset frame center based on zoom target
        // When zooming at (0.5, 0.5), center stays the same
        // When zooming at other points, the frame shifts so that point stays centered
        let zoom_offset = (zoom_center - vec2<f32>(0.5)) * frame_size * (zoom_scale - 1.0);
        frame_center = base_frame_center - zoom_offset;
    }

    // Calculate SDF for video frame using zoomed geometry
    let rel_pos = pixel_pos - frame_center;
    let frame_dist = sdf_rounded_rect_styled(rel_pos, frame_half_size, rounding_px, rounding_type);

    // Start with transparent (background shows through)
    var color = vec4<f32>(0.0, 0.0, 0.0, 0.0);

    // Render shadow behind video frame (matching webcam shadow formula)
    // Single slider controls both blur size and opacity
    if (shadow_enabled && frame_dist > 0.0) {
        let min_frame_size = min(frame_half_size.x, frame_half_size.y);
        let strength = shadow_value / 100.0;

        // Derive blur and opacity from single value (matches webcam formula)
        // blur = strength * minDim * 0.15
        // opacity = strength * 0.5
        let shadow_blur = strength * min_frame_size * 0.15;
        let shadow_opacity = strength * 0.5;

        // Soft gaussian falloff
        let normalized_dist = frame_dist / max(shadow_blur * 2.0, 1.0);
        let shadow_fade = exp(-normalized_dist * normalized_dist);
        let shadow_alpha = shadow_fade * shadow_opacity;

        if (shadow_alpha > 0.001) {
            color = vec4<f32>(0.0, 0.0, 0.0, shadow_alpha);
        }
    }

    // Render border around video frame
    if (border_enabled && border_width > 0.0) {
        let border_outer_dist = sdf_rounded_rect_styled(
            rel_pos,
            frame_half_size + vec2<f32>(border_width),
            rounding_px + border_width,
            rounding_type
        );

        if (border_outer_dist <= 0.0 && frame_dist > 0.0) {
            // Inside border ring
            let inner_alpha = smoothstep(-0.5, 0.5, frame_dist);
            let outer_alpha = 1.0 - smoothstep(-0.5, 0.5, border_outer_dist);
            let edge_alpha = inner_alpha * outer_alpha;

            let border_alpha = edge_alpha * uniforms.border_color.w;
            let border_rgb = uniforms.border_color.xyz;

            // Blend in sRGB space to match CSS preview appearance
            // CSS does gamma-incorrect blending, so we match it for consistency
            let srgb_prev = linear_to_srgb_vec3(color.rgb);
            let srgb_border = linear_to_srgb_vec3(border_rgb);
            let blended_srgb = mix(srgb_prev, srgb_border, border_alpha);
            let blended_linear = srgb_to_linear_vec3(blended_srgb);

            // Calculate alpha: standard over composite
            let result_alpha = color.a * (1.0 - border_alpha) + border_alpha;
            color = vec4<f32>(blended_linear, result_alpha);
        }
    }

    // Render video frame content
    if (frame_dist <= 0.0) {
        // Calculate UV within the zoomed frame
        // Since zoom is already applied to frame geometry, UV is a simple mapping
        // rel_pos is relative to zoomed frame center, frame_half_size is zoomed
        let video_uv = clamp(rel_pos / (frame_half_size * 2.0) + vec2<f32>(0.5), vec2<f32>(0.0), vec2<f32>(1.0));

        // Sample video, optionally adding camera-style blur while zoom is moving.
        var video_color = sample_zoom_motion_blur(video_uv, zoom_center, frame_half_size);

        // Anti-alias the edges (matching Cap's approach)
        let anti_alias_width = max(fwidth(frame_dist), 0.5);
        let coverage = clamp(1.0 - smoothstep(0.0, anti_alias_width, frame_dist), 0.0, 1.0);
        // Screen/video content is opaque. Some decode/upload paths can leave edge
        // alpha at zero, which lets wallpaper backgrounds show through the top/left
        // pixels even though the source video should fully cover the frame.
        video_color.a = coverage;

        // Blend video over shadow/border
        color = mix(color, video_color, video_color.a);
    }

    // Webcam overlay (on top of everything)
    let webcam_shape = uniforms.webcam_params.x;
    if (webcam_shape > 0.5) {
        let webcam_pos = uniforms.webcam_rect.xy;
        let webcam_size = uniforms.webcam_rect.zw;
        let webcam_shadow_strength = uniforms.webcam_params.y;
        let mirror = uniforms.webcam_params.z;
        let corner_radius = uniforms.webcam_params.w;

        let webcam_shadow_size = uniforms.webcam_shadow.x;
        let webcam_shadow_opacity = uniforms.webcam_shadow.y;
        let webcam_shadow_blur = uniforms.webcam_shadow.z;

        let webcam_center = webcam_pos + webcam_size * 0.5;
        let webcam_half_size = webcam_size * 0.5;

        let webcam_rel_pos = input.uv - webcam_center;
        let webcam_pixel_pos = webcam_rel_pos * uniforms.output_size.xy;
        let webcam_pixel_half_size = webcam_half_size * uniforms.output_size.xy;
        let min_webcam_size = min(webcam_pixel_half_size.x, webcam_pixel_half_size.y);

        let normalized_webcam_pos = webcam_pixel_pos / min_webcam_size;
        let normalized_webcam_half = vec2<f32>(1.0, 1.0);

        let webcam_dist = webcam_sdf(normalized_webcam_pos, normalized_webcam_half, webcam_shape, corner_radius / min_webcam_size);

        // Webcam shadow
        if (webcam_shadow_strength > 0.0 && webcam_dist > 0.0) {
            let ws_spread = webcam_shadow_size * 0.5;
            let ws_blur = webcam_shadow_blur * 0.5;
            let ws_dist = webcam_dist - ws_spread;
            let ws_alpha = (1.0 - smoothstep(-ws_blur, ws_blur * 2.0, ws_dist)) * webcam_shadow_opacity * webcam_shadow_strength;

            if (ws_alpha > 0.001) {
                color = mix(color, vec4<f32>(0.0, 0.0, 0.0, 1.0), ws_alpha);
            }
        }

        // Webcam content — 1px anti-aliasing matching frame border crispness
        let webcam_aa_width = max(fwidth(webcam_dist), 0.5 / min_webcam_size);
        if (webcam_dist <= webcam_aa_width) {
            var webcam_uv = (input.uv - webcam_pos) / webcam_size;

            if (mirror > 0.5) {
                webcam_uv.x = 1.0 - webcam_uv.x;
            }

            let aspect = uniforms.webcam_tex_size.z;
            if (aspect > 1.0) {
                let crop_amount = (1.0 - 1.0 / aspect) * 0.5;
                webcam_uv.x = crop_amount + webcam_uv.x * (1.0 / aspect);
            } else if (aspect < 1.0) {
                let crop_amount = (1.0 - aspect) * 0.5;
                webcam_uv.y = crop_amount + webcam_uv.y * aspect;
            }

            webcam_uv = clamp(webcam_uv, vec2<f32>(0.0), vec2<f32>(1.0));

            let webcam_color = textureSample(webcam_texture, webcam_sampler, webcam_uv);
            let webcam_alpha = clamp(1.0 - smoothstep(0.0, webcam_aa_width, webcam_dist), 0.0, 1.0);
            color = mix(color, webcam_color, webcam_alpha * webcam_color.a);
        }
    }

    return color;
}

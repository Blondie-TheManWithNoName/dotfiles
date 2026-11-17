// swipe_right.frag
precision mediump float;

uniform sampler2D tex;
uniform vec2 resolution;
uniform float time;

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    // Shift the screen slightly to the right over time
    float shift = smoothstep(0.0, 1.0, time) * -0.1;
    uv.x += shift;

    vec4 color = texture2D(tex, uv);
    gl_FragColor = color;
}


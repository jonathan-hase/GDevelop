namespace gdjs {
  interface GenZoomBlurFilterNetworkSyncData {
    cx: number;
    cy: number;
    ir: number;
    s: number;
    p: number;
  }

  /**
   * The maximum number of texture samples the zoom blur loop can take.
   * GLSL ES 1.00 requires a constant loop bound, so this is baked into the
   * shader source at construction time (like PixiJS' own `maxKernelSize`).
   * The loop breaks early: the actual number of taps is computed per pixel
   * from the real streak length, so this is only a ceiling.
   */
  const MAX_TAPS = 32;

  /**
   * The `padding` property is divided by this to get the base blur radius in
   * pixels, so that a value of 1 means a very subtle 0.1 pixel blur.
   */
  const BASE_RADIUS_DIVIDER = 10;

  /** Base blur radius is clamped to this, the ring stops reading as a blur above it. */
  const MAX_BASE_RADIUS_PX = 8;

  const genZoomBlurFragmentShader = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    '',
    'varying vec2 vTextureCoord;',
    'uniform sampler2D uSampler;',
    '',
    '// Filled by PixiJS for every filter:',
    '// inputSize   = (textureWidth, textureHeight, 1/textureWidth, 1/textureHeight)',
    '// outputFrame = (x, y, width, height) of the filter frame, in screen units',
    '// inputClamp  = (minU, minV, maxU, maxV) of the valid region in the pooled texture',
    'uniform vec4 inputSize;',
    'uniform vec4 outputFrame;',
    'uniform vec4 inputClamp;',
    '',
    'uniform vec2 uCenterPx;',
    'uniform float uStrength;',
    'uniform float uInnerRadiusPx;',
    'uniform float uBaseRadiusPx;',
    '',
    'const float MAX_TAPS = ${MAX_TAPS};',
    '',
    '// Screen pixels of streak covered by one texture tap. Two is about the most',
    '// bilinear filtering can bridge before the samples read as separate ghosts.',
    'const float TAP_SPACING_PX = 2.0;',
    '',
    '// Streak length at which the ray takes over the base blur from the ring. The',
    '// perpendicular displacement cycles through three positions, so it needs at',
    '// least three taps to be balanced, and three taps means this much streak.',
    'const float PERPENDICULAR_FROM_PX = 3.0 * TAP_SPACING_PX;',
    '',
    '// Interleaved Gradient Noise (Jimenez, SIGGRAPH 2014). Cheaper and better',
    '// distributed than the classic sin() hash, which is what makes low tap',
    '// counts usable: it turns the ghost rings of a fixed sample comb into grain.',
    'float ign(vec2 p) {',
    '    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));',
    '}',
    '',
    '// The pooled filter texture is usually larger than the region we render to,',
    '// so any tap that could leave the frame must be clamped to the valid area.',
    'vec4 tap(vec2 uv) {',
    '    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));',
    '}',
    '',
    'void main() {',
    '    // Exact screen-space position of this fragment. Working in screen pixels',
    '    // (instead of dividing by the texture size) keeps the center and the radii',
    '    // correct whatever size the pooled texture happens to be.',
    '    vec2 fragPx = vTextureCoord * inputSize.xy + outputFrame.xy;',
    '    vec2 toCenter = uCenterPx - fragPx;',
    '    float dist = length(toCenter);',
    '',
    '    // Sharp core, with a soft band 30% of the inner radius wide centred on it.',
    '    // smoothstep rather than the linear ramp upstream uses, so the boundary',
    '    // has no corner in it at either end.',
    '    float halfBand = max(uInnerRadiusPx * 0.15, 0.00005);',
    '    float fade = smoothstep(',
    '        uInnerRadiusPx - halfBand,',
    '        uInnerRadiusPx + halfBand,',
    '        dist',
    '    );',
    '',
    '    // Length of the streak this pixel actually needs.',
    '    float streakPx = dist * uStrength * fade;',
    '',
    '    // Step along the ray by a fixed number of *pixels*, not by a fixed',
    '    // fraction of it. With a fixed fraction, every sample position shifts at',
    '    // once whenever the tap count steps up, and on repetitive 1-bit art that',
    '    // lands as hard concentric rings. Stepping by pixels keeps every position',
    '    // put and lets each new tap fade in from zero weight as the streak grows.',
    '    // The lower bound keeps 32 taps covering the whole ray at high strength,',
    '    // the upper bound keeps at least two taps once there is anything to blur.',
    '    float pStep = clamp(',
    '        TAP_SPACING_PX / max(streakPx, 0.0001),',
    '        1.0 / MAX_TAPS,',
    '        0.5',
    '    );',
    '',
    '    vec4 color;',
    '    // The threshold is deliberately far below one pixel. The blur is centred',
    '    // half a streak toward the middle, so entering it at half a pixel means',
    '    // entering it with a quarter pixel of displacement already applied, and',
    '    // that shows on 1px detail as a ring. Entering at a twentieth of a pixel',
    '    // costs a couple of taps in a thin annulus and is invisible.',
    '    if (streakPx > 0.05) {',
    '        float offset = ign(gl_FragCoord.xy);',
    '        vec2 rayUV = toCenter * (uStrength * fade) * inputSize.zw;',
    '',
    '        // Displacing taps perpendicular to the ray gives the streak the same',
    '        // width as the base blur, without costing a single extra tap. The',
    '        // displacement cycles -1, 0, +1: skipping the middle would hollow out',
    '        // 1px lines, which is what 1-bit line art is made of.',
    '        float perpAmount =',
    '            (uBaseRadiusPx > 0.0 && streakPx >= PERPENDICULAR_FROM_PX)',
    '                ? uBaseRadiusPx',
    '                : 0.0;',
    '        vec2 perpUV =',
    '            vec2(-toCenter.y, toCenter.x) *',
    '            (perpAmount / max(dist, 0.0001)) *',
    '            inputSize.zw;',
    '',
    '        // Trim the ray once, here, so that not a single tap inside the loop',
    '        // needs a clamp. The ray is a straight segment inside a convex box,',
    '        // so keeping its far end in bounds keeps every tap in bounds.',
    '        vec2 reach = abs(perpUV);',
    '        vec2 low = inputClamp.xy + reach;',
    '        vec2 high = inputClamp.zw - reach;',
    '        vec2 origin = clamp(vTextureCoord, low, high);',
    '        vec2 room = mix(high - origin, origin - low, step(rayUV, vec2(0.0)));',
    '        vec2 denominator = max(abs(rayUV), vec2(0.000001));',
    '        rayUV *= clamp(min(room.x / denominator.x, room.y / denominator.y), 0.0, 1.0);',
    '',
    '        // Everything below is incremental: no divide, no mod, no clamp per tap.',
    '        float percent = offset * pStep;',
    '        vec2 rayStep = rayUV * pStep;',
    '        vec2 uv = origin + rayUV * percent;',
    '        float side = -1.0;',
    '        float total = 0.0;',
    '        color = vec4(0.0);',
    '        for (float t = 0.0; t < MAX_TAPS; t++) {',
    '            if (percent > 1.0) break;',
    '            float weight = 4.0 * (percent - percent * percent);',
    '            color += texture2D(uSampler, uv + perpUV * side) * weight;',
    '            total += weight;',
    '            percent += pStep;',
    '            uv += rayStep;',
    '            side = side >= 1.0 ? -1.0 : side + 1.0;',
    '        }',
    '        color /= max(total, 0.0001);',
    '    } else {',
    '        color = texture2D(uSampler, vTextureCoord);',
    '    }',
    '',
    '    // Base blur: a small isotropic blur applied everywhere, including inside',
    '    // the sharp core where the zoom blur contributes nothing.',
    '    //',
    '    // Past the handover the ray taps already carry it, through the',
    '    // perpendicular displacement above, so the ring is not merely faded out',
    '    // there, it is skipped. It used to be evaluated on every pixel of the',
    '    // screen and then multiplied by zero over most of them.',
    '    float ringRange = max(2.0 * uBaseRadiusPx, PERPENDICULAR_FROM_PX);',
    '    float mixFactor = clamp(streakPx / ringRange, 0.0, 1.0);',
    '    if (uBaseRadiusPx > 0.0 && mixFactor < 1.0) {',
    '        vec2 r = uBaseRadiusPx * inputSize.zw;',
    '        // Centre weighted 4, then a ring of unit weights exactly one radius',
    '        // out. Two things depend on the centre tap being there: a ring alone',
    '        // erases 1px lines (every tap misses them), and it quantises a hard',
    '        // edge into a few flat plateaus instead of a grey ramp.',
    '        vec2 d = r * 0.70710678;',
    '        vec4 ring = texture2D(uSampler, vTextureCoord) * 4.0;',
    '        ring += tap(vTextureCoord + vec2(d.x, d.y)) +',
    '            tap(vTextureCoord + vec2(-d.x, d.y)) +',
    '            tap(vTextureCoord + vec2(d.x, -d.y)) +',
    '            tap(vTextureCoord + vec2(-d.x, -d.y));',
    '        float ringWeight = 8.0;',
    '        if (uBaseRadiusPx > 2.0) {',
    '            // Above a couple of pixels four taps read as four ghosts, so fill',
    '            // the ring in to eight evenly spaced points.',
    '            ring += tap(vTextureCoord + vec2(r.x, 0.0)) +',
    '                tap(vTextureCoord + vec2(-r.x, 0.0)) +',
    '                tap(vTextureCoord + vec2(0.0, r.y)) +',
    '                tap(vTextureCoord + vec2(0.0, -r.y));',
    '            ringWeight = 12.0;',
    '        }',
    '        color = mix(ring / ringWeight, color, mixFactor);',
    '    }',
    '',
    '    // PixiJS render textures are premultiplied, so a straight weighted average',
    '    // is already the correct way to blur images with an alpha channel.',
    '    gl_FragColor = color;',
    '}',
  ].join('\n');

  /**
   * A zoom blur that always covers the whole viewport and only pays for the
   * blur it actually produces.
   *
   * Differences with the `ZoomBlur` effect (`@pixi/filter-zoom-blur`):
   * - The filter frame is pinned to the layer viewport instead of being derived
   *   from the bounds of the objects on the layer. This is what makes the blur
   *   fill the screen without the `padding` workaround, and it also fixes the
   *   center: PixiJS reports the *pooled texture* size (rounded up to a power of
   *   two) as `filterArea`, so any center expressed relative to it is wrong
   *   unless the frame happens to be exactly the screen.
   * - The number of texture samples is computed per pixel from the streak length
   *   instead of always being 32.
   * - A tunable base blur, reusing the freed `padding` property, is folded into
   *   the same pass.
   *
   * @internal
   */
  export class GenZoomBlurPixiFilter extends PIXI.Filter {
    /** Center of the zoom, normalized in the viewport (0;0 is top-left, 1;1 bottom-right). */
    _centerX: number = 0.5;
    _centerY: number = 0.5;

    /** The `padding` value as set by the user, kept so it can be read back as-is. */
    _rawPadding: number = 0;
    /** Base blur radius in pixels, ten times smaller than the `padding` value. */
    _baseRadiusPx: number = 0;

    /** The viewport rectangle, reused every frame to avoid any allocation. */
    _viewportRect: PIXI.Rectangle = new PIXI.Rectangle(0, 0, 1, 1);

    constructor() {
      super(
        undefined,
        genZoomBlurFragmentShader.replace('${MAX_TAPS}', MAX_TAPS.toFixed(1)),
        {
          uCenterPx: new Float32Array([0, 0]),
          uStrength: 0,
          uInnerRadiusPx: 0,
          uBaseRadiusPx: 0,
        }
      );
      // The filter frame is pinned to the viewport, so no padding is ever needed.
      this.padding = 0;
    }

    /**
     * The `padding` property is reused as the base blur radius: the blur applied
     * everywhere, including inside the sharp core. It is divided by ten, so a
     * value of 1 is a very subtle 0.1 pixel blur.
     */
    setPadding(value: number): void {
      this._rawPadding = value;
      this._baseRadiusPx = gdjs.PixiFiltersTools.clampValue(
        value / BASE_RADIUS_DIVIDER,
        0,
        MAX_BASE_RADIUS_PX
      );
      this.uniforms.uBaseRadiusPx = this._baseRadiusPx;
    }

    /**
     * Pin the filter frame to the layer viewport, and update everything that
     * depends on the viewport size.
     */
    updateForTarget(target: gdjs.EffectsTarget): void {
      const width = target.getWidth();
      const height = target.getHeight();
      const rendererObject = target.getRendererObject() as
        | PIXI.Container
        | null
        | undefined;
      if (!rendererObject) {
        return;
      }

      // The viewport, expressed in the world coordinates that PixiJS expects
      // for `filterArea` (the same space as `getBounds`). For a scene layer the
      // parent transform is the identity, but a layer of a custom object is
      // placed in the world.
      const parent = rendererObject.parent;
      const rect = this._viewportRect;
      let centerX = this._centerX * width;
      let centerY = this._centerY * height;
      if (parent) {
        const matrix = parent.worldTransform;
        const x0 = matrix.tx;
        const y0 = matrix.ty;
        const x1 = matrix.a * width + matrix.tx;
        const y1 = matrix.b * width + matrix.ty;
        const x2 = matrix.c * height + matrix.tx;
        const y2 = matrix.d * height + matrix.ty;
        const x3 = x1 + matrix.c * height;
        const y3 = y1 + matrix.d * height;
        rect.x = Math.min(x0, x1, x2, x3);
        rect.y = Math.min(y0, y1, y2, y3);
        rect.width = Math.max(x0, x1, x2, x3) - rect.x;
        rect.height = Math.max(y0, y1, y2, y3) - rect.y;

        const localCenterX = centerX;
        const localCenterY = centerY;
        centerX = matrix.a * localCenterX + matrix.c * localCenterY + matrix.tx;
        centerY = matrix.b * localCenterX + matrix.d * localCenterY + matrix.ty;
      } else {
        rect.x = 0;
        rect.y = 0;
        rect.width = width;
        rect.height = height;
      }
      rendererObject.filterArea = rect;

      const center = this.uniforms.uCenterPx;
      center[0] = centerX;
      center[1] = centerY;
    }
  }
  GenZoomBlurPixiFilter.prototype.constructor = gdjs.GenZoomBlurPixiFilter;

  gdjs.PixiFiltersTools.registerFilterCreator(
    'GenZoomBlur',
    new (class extends gdjs.PixiFiltersTools.PixiFilterCreator {
      makePIXIFilter(target: EffectsTarget, effectData) {
        return new gdjs.GenZoomBlurPixiFilter();
      }
      updatePreRender(filter: PIXI.Filter, target: EffectsTarget) {
        (filter as gdjs.GenZoomBlurPixiFilter).updateForTarget(target);
      }
      updateDoubleParameter(
        filter: PIXI.Filter,
        parameterName: string,
        value: number
      ) {
        const genZoomBlurFilter = filter as gdjs.GenZoomBlurPixiFilter;
        if (parameterName === 'centerX') {
          genZoomBlurFilter._centerX = value;
        } else if (parameterName === 'centerY') {
          genZoomBlurFilter._centerY = value;
        } else if (parameterName === 'innerRadius') {
          genZoomBlurFilter.uniforms.uInnerRadiusPx = Math.max(0, value);
        } else if (parameterName === 'strength') {
          // Same scaling as the ZoomBlur effect, so both are driven identically.
          genZoomBlurFilter.uniforms.uStrength =
            gdjs.PixiFiltersTools.clampValue(value / 10, 0, 20);
        } else if (parameterName === 'padding') {
          genZoomBlurFilter.setPadding(value);
        }
      }
      getDoubleParameter(filter: PIXI.Filter, parameterName: string): number {
        const genZoomBlurFilter = filter as gdjs.GenZoomBlurPixiFilter;
        if (parameterName === 'centerX') {
          return genZoomBlurFilter._centerX;
        }
        if (parameterName === 'centerY') {
          return genZoomBlurFilter._centerY;
        }
        if (parameterName === 'innerRadius') {
          return genZoomBlurFilter.uniforms.uInnerRadiusPx;
        }
        if (parameterName === 'strength') {
          return genZoomBlurFilter.uniforms.uStrength;
        }
        if (parameterName === 'padding') {
          return genZoomBlurFilter._rawPadding;
        }
        return 0;
      }
      updateStringParameter(
        filter: PIXI.Filter,
        parameterName: string,
        value: string
      ) {}
      updateColorParameter(
        filter: PIXI.Filter,
        parameterName: string,
        value: number
      ): void {}
      getColorParameter(filter: PIXI.Filter, parameterName: string): number {
        return 0;
      }
      updateBooleanParameter(
        filter: PIXI.Filter,
        parameterName: string,
        value: boolean
      ) {}
      getNetworkSyncData(
        filter: PIXI.Filter
      ): GenZoomBlurFilterNetworkSyncData {
        const genZoomBlurFilter = filter as gdjs.GenZoomBlurPixiFilter;
        return {
          cx: genZoomBlurFilter._centerX,
          cy: genZoomBlurFilter._centerY,
          ir: genZoomBlurFilter.uniforms.uInnerRadiusPx,
          s: genZoomBlurFilter.uniforms.uStrength,
          p: genZoomBlurFilter._rawPadding,
        };
      }
      updateFromNetworkSyncData(
        filter: PIXI.Filter,
        data: GenZoomBlurFilterNetworkSyncData
      ) {
        const genZoomBlurFilter = filter as gdjs.GenZoomBlurPixiFilter;
        genZoomBlurFilter._centerX = data.cx;
        genZoomBlurFilter._centerY = data.cy;
        genZoomBlurFilter.uniforms.uInnerRadiusPx = data.ir;
        genZoomBlurFilter.uniforms.uStrength = data.s;
        genZoomBlurFilter.setPadding(data.p);
      }
    })()
  );
}

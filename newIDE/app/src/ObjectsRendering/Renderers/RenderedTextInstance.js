// @flow
import RenderedInstance from './RenderedInstance';
import PixiResourcesLoader from '../../ObjectsRendering/PixiResourcesLoader';
import ResourcesLoader from '../../ResourcesLoader';
import { rgbStringToHexNumber } from '../../Utils/ColorTransformer';
import * as PIXI from 'pixi.js-legacy';
const gd: libGDevelop = global.gd;

// Alpha value below which a pixel is made fully transparent (instead of
// fully opaque) when de-antialiasing a text.
const CRISP_ALPHA_THRESHOLD = 128;

// Fraction of partial-coverage pixels (relative to all covered pixels) above
// which thresholding would destroy the glyph shapes instead of just cleaning
// their fringe. Pixel fonts rasterized on the pixel grid stay well below
// this; regular fonts at small sizes, fallback glyphs (e.g. CJK rendered
// with a system font) and lines landing on fractional pixel positions are
// far above it.
const CRISP_MAX_INTERMEDIATE_RATIO = 0.35;

/**
 * Remove the font antialiasing done by the browser on the canvas the text
 * was rasterized on, by thresholding the alpha channel, and sample the
 * resulting texture with NEAREST scaling - to match what the game does at
 * runtime when the project uses the "nearest" scale mode.
 *
 * The thresholding is only applied when the rasterization is already
 * near-binary (a pixel font at its native size, on the pixel grid) -
 * thresholding a mostly partial-coverage rasterization would make the text
 * unreadable, so the antialiasing is kept in that case.
 *
 * Rasterizes the text (consuming any pending re-rasterization, so PixiJS
 * won't rasterize it again at render time, which would restore the
 * antialiasing).
 */
// $FlowFixMe[value-as-type]
const applyCrispRenderingToPixiText = (pixiText: PIXI.Text) => {
  const context = pixiText.context;
  if (!context) return;
  // Reduce fractional glyph positioning so that pixel fonts rasterize on
  // the pixel grid (kerning and ligatures shift glyphs to sub-pixel
  // offsets). Must be set before the rasterization done by updateText.
  context.textRendering = 'optimizeSpeed';
  context.fontKerning = 'none';

  pixiText.updateText(true);
  const canvas = pixiText.canvas;
  if (!canvas || canvas.width === 0 || canvas.height === 0) return;

  pixiText.texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let intermediateCount = 0;
  let opaqueCount = 0;
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i];
    if (alpha === 255) opaqueCount++;
    else if (alpha !== 0) intermediateCount++;
  }
  const coveredCount = intermediateCount + opaqueCount;
  if (
    coveredCount === 0 ||
    intermediateCount / coveredCount > CRISP_MAX_INTERMEDIATE_RATIO
  ) {
    return;
  }

  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] < CRISP_ALPHA_THRESHOLD ? 0 : 255;
  }
  context.putImageData(imageData, 0, 0);
  pixiText.texture.baseTexture.update();
};

/**
 * Renderer for a Text object.
 */
export default class RenderedTextInstance extends RenderedInstance {
  _isItalic: boolean = false;
  _isBold: boolean = false;
  _characterSize: number = 0;
  _wrapping: boolean = false;
  _wrappingWidth: number = 0;
  _styleFontDirty: boolean = true;
  _fontName: string = '';
  _fontFamily: string = '';
  _color: string = '0;0;0';
  _textAlignment: string = 'left';
  _verticalTextAlignment: string = 'top';

  _isOutlineEnabled = false;
  _outlineColor = '255;255;255';
  _outlineThickness = 2;

  _isShadowEnabled = false;
  _shadowDistance = 3;
  _shadowAngle = 90;
  _shadowColor = '0;0;0';
  _shadowOpacity = 127;
  _shadowBlurRadius = 2;
  _lineHeight = 0;
  _isCrispTextRendering: boolean = false;

  constructor(
    project: gdProject,
    instance: gdInitialInstance,
    associatedObjectConfiguration: gdObjectConfiguration,
    // $FlowFixMe[value-as-type]
    pixiContainer: PIXI.Container,
    pixiResourcesLoader: Class<PixiResourcesLoader>,
    getPropertyOverridings: (() => Map<string, string>) | null
  ) {
    super(
      project,
      instance,
      associatedObjectConfiguration,
      pixiContainer,
      pixiResourcesLoader,
      getPropertyOverridings
    );

    const style = new PIXI.TextStyle({
      fontFamily: 'Arial',
      fontSize: 20,
      align: 'left',
      padding: 5,
    });

    //Setup the PIXI object:
    this._pixiObject = new PIXI.Text('', style);
    this._pixiObject.anchor.x = 0.5;
    this._pixiObject.anchor.y = 0.5;
    this._pixiContainer.addChild(this._pixiObject);
    this._styleFontDirty = true;
    this.update();
  }

  onRemovedFromScene(): void {
    super.onRemovedFromScene();
    this._pixiObject.destroy(true);
  }

  /**
   * Return a URL for thumbnail of the specified object.
   */
  static getThumbnail(
    project: gdProject,
    resourcesLoader: Class<ResourcesLoader>,
    objectConfiguration: gdObjectConfiguration
  ): any {
    return 'CppPlatform/Extensions/texticon24.png';
  }

  update() {
    const textObjectConfiguration = gd.asTextObjectConfiguration(
      this._associatedObjectConfiguration
    );
    const propertyOverridings = this.getPropertyOverridings();
    this._pixiObject.text =
      propertyOverridings && propertyOverridings.has('Text')
        ? propertyOverridings.get('Text')
        : textObjectConfiguration.getText();

    //Update style, only if needed to avoid destroying text rendering performances
    if (
      textObjectConfiguration.isItalic() !== this._isItalic ||
      textObjectConfiguration.isBold() !== this._isBold ||
      textObjectConfiguration.getCharacterSize() !== this._characterSize ||
      textObjectConfiguration.getLineHeight() !== this._lineHeight ||
      textObjectConfiguration.getTextAlignment() !== this._textAlignment ||
      textObjectConfiguration.getVerticalTextAlignment() !==
        this._verticalTextAlignment ||
      textObjectConfiguration.getColor() !== this._color ||
      textObjectConfiguration.isOutlineEnabled() !== this._isOutlineEnabled ||
      textObjectConfiguration.getOutlineColor() !== this._outlineColor ||
      textObjectConfiguration.getOutlineThickness() !==
        this._outlineThickness ||
      textObjectConfiguration.isShadowEnabled() !== this._isShadowEnabled ||
      textObjectConfiguration.getShadowDistance() !== this._shadowDistance ||
      textObjectConfiguration.getShadowAngle() !== this._shadowAngle ||
      textObjectConfiguration.getShadowColor() !== this._shadowColor ||
      textObjectConfiguration.getShadowOpacity() !== this._shadowOpacity ||
      textObjectConfiguration.getShadowBlurRadius() !==
        this._shadowBlurRadius ||
      this._instance.hasCustomSize() !== this._wrapping ||
      (this.getCustomWidth() !== this._wrappingWidth && this._wrapping)
    ) {
      this._isItalic = textObjectConfiguration.isItalic();
      this._isBold = textObjectConfiguration.isBold();
      this._characterSize = textObjectConfiguration.getCharacterSize();
      this._lineHeight = textObjectConfiguration.getLineHeight();
      this._textAlignment = textObjectConfiguration.getTextAlignment();
      this._verticalTextAlignment = textObjectConfiguration.getVerticalTextAlignment();
      this._color = textObjectConfiguration.getColor();

      this._isOutlineEnabled = textObjectConfiguration.isOutlineEnabled();
      this._outlineColor = textObjectConfiguration.getOutlineColor();
      this._outlineThickness = textObjectConfiguration.getOutlineThickness();

      this._isShadowEnabled = textObjectConfiguration.isShadowEnabled();
      this._shadowDistance = textObjectConfiguration.getShadowDistance();
      this._shadowAngle = textObjectConfiguration.getShadowAngle();
      this._shadowColor = textObjectConfiguration.getShadowColor();
      this._shadowOpacity = textObjectConfiguration.getShadowOpacity();
      this._shadowBlurRadius = textObjectConfiguration.getShadowBlurRadius();

      this._wrapping = this._instance.hasCustomSize();
      this._wrappingWidth = this.getCustomWidth();
      this._styleFontDirty = true;
    }

    if (this._fontName !== textObjectConfiguration.getFontName()) {
      //Avoid calling loadFontFamily if the font didn't changed.
      this._fontName = textObjectConfiguration.getFontName();
      PixiResourcesLoader.loadFontFamily(
        this._project,
        textObjectConfiguration.getFontName()
      )
        .then(fontFamily => {
          if (this._wasDestroyed) return;

          // Once the font is loaded, we can use the given fontFamily.
          this._fontFamily = fontFamily;
          this._styleFontDirty = true;
        })
        .catch(err => {
          // Ignore errors
          console.warn(
            'Unable to load font family for RenderedTextInstance',
            err
          );
        });
    }

    if (this._styleFontDirty) {
      const style = this._pixiObject.style;
      style.fontFamily = this._fontFamily || 'Arial';
      style.fontSize = Math.max(1, this._characterSize);
      style.fontStyle = this._isItalic ? 'italic' : 'normal';
      style.fontWeight = this._isBold ? 'bold' : 'normal';
      style.lineHeight = this._lineHeight !== 0 ? this._lineHeight : undefined;
      style.fill = rgbStringToHexNumber(this._color);
      style.wordWrap = this._wrapping;
      style.wordWrapWidth = this._wrappingWidth <= 1 ? 1 : this._wrappingWidth;
      style.breakWords = true;
      style.align = this._textAlignment;

      style.stroke = rgbStringToHexNumber(this._outlineColor);
      style.strokeThickness = this._isOutlineEnabled
        ? this._outlineThickness
        : 0;
      style.dropShadow = this._isShadowEnabled;
      style.dropShadowColor = rgbStringToHexNumber(this._shadowColor);
      style.dropShadowAlpha = this._shadowOpacity / 255;
      style.dropShadowBlur = this._shadowBlurRadius;
      style.dropShadowAngle = RenderedInstance.toRad(this._shadowAngle);
      style.dropShadowDistance = this._shadowDistance;
      const extraPaddingForShadow = style.dropShadow
        ? style.dropShadowDistance + style.dropShadowBlur
        : 0;
      style.padding = Math.ceil(extraPaddingForShadow);

      // Manually ask the PIXI object to re-render as we changed a style property
      // see http://www.html5gamedevs.com/topic/16924-change-text-style-post-render/
      this._pixiObject.dirty = true;
      this._styleFontDirty = false;
    }

    // De-antialias the text when the project uses the "nearest" scale mode,
    // to match what the game does at runtime.
    const isCrispTextRendering = this._project.getScaleMode() === 'nearest';
    if (isCrispTextRendering !== this._isCrispTextRendering) {
      // The scale mode was changed in the project properties: force a
      // re-rasterization of the text.
      this._isCrispTextRendering = isCrispTextRendering;
      this._pixiObject.dirty = true;
      if (!isCrispTextRendering) {
        this._pixiObject.texture.baseTexture.scaleMode =
          PIXI.SCALE_MODES.LINEAR;
      }
    }
    if (isCrispTextRendering) {
      const pixiText = this._pixiObject;
      // Only post-process the text when a re-rasterization is pending
      // (text changed, style changed or font loaded) as `update` is called
      // on every frame. This must be done before anything reads the text
      // width or height below, as this would trigger the re-rasterization.
      if (pixiText.dirty || pixiText.localStyleID !== pixiText.style.styleID) {
        applyCrispRenderingToPixiText(pixiText);
      }
    }

    if (this._instance.hasCustomSize() && this._pixiObject.width !== 0) {
      const alignmentX =
        this._textAlignment === 'right'
          ? 1
          : this._textAlignment === 'center'
          ? 0.5
          : 0;

      const width = this.getCustomWidth();

      // A vector from the custom size center to the renderer center.
      const centerToCenterX =
        (width - this._pixiObject.width) * (alignmentX - 0.5);

      this._pixiObject.position.x = this._instance.getX() + width / 2;
      this._pixiObject.anchor.x =
        0.5 - centerToCenterX / this._pixiObject.width;
    } else {
      this._pixiObject.position.x =
        this._instance.getX() + this._pixiObject.width / 2;
      this._pixiObject.anchor.x = 0.5;
    }
    const alignmentY =
      this._verticalTextAlignment === 'bottom'
        ? 1
        : this._verticalTextAlignment === 'center'
        ? 0.5
        : 0;
    this._pixiObject.position.y =
      this._instance.getY() + this._pixiObject.height * (0.5 - alignmentY);
    this._pixiObject.anchor.y = 0.5;

    this._pixiObject.rotation = RenderedInstance.toRad(
      this._instance.getAngle()
    );

    // Do not hide completely an object so it can still be manipulated
    const alphaForDisplay = Math.max(this._instance.getOpacity() / 255, 0.5);
    this._pixiObject.alpha = alphaForDisplay;
  }

  getDefaultWidth(): any {
    // The default width is dependent of the current wrapping width.
    // You should avoid to use this value.
    return this._pixiObject.width;
  }

  getDefaultHeight(): any {
    // The default height is dependent of the current wrapping width.
    // You should avoid to use this value.
    return this._pixiObject.height;
  }

  getOriginY(): number {
    const height = this.getHeight();
    return this._verticalTextAlignment === 'bottom'
      ? height
      : this._verticalTextAlignment === 'center'
      ? height / 2
      : 0;
  }
}

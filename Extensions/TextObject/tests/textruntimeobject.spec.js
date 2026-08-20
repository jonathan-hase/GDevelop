// @ts-check

describe('gdjs.TextRuntimeObject (crisp rendering with "nearest" scale mode)', () => {
  /**
   * @param {gdjs.RuntimeScene} runtimeScene
   * @param {{characterSize?: number, bold?: boolean}=} options
   * @returns {gdjs.TextRuntimeObject}
   */
  const makeTextRuntimeObject = (runtimeScene, options) =>
    new gdjs.TextRuntimeObject(runtimeScene, {
      name: 'text1',
      type: 'TextObject::Text',
      variables: [],
      behaviors: [],
      effects: [],
      content: {
        characterSize: (options && options.characterSize) || 20,
        font: '',
        bold: (options && options.bold) || false,
        italic: false,
        underlined: false,
        color: '0;0;0',
        text: 'Hello 123',
        textAlignment: 'left',
        verticalTextAlignment: 'top',
        lineHeight: 0,
        isOutlineEnabled: false,
        outlineThickness: 2,
        outlineColor: '255;255;255',
        isShadowEnabled: false,
        shadowColor: '0;0;0',
        shadowOpacity: 127,
        shadowDistance: 3,
        shadowAngle: 90,
        shadowBlurRadius: 2,
      },
    });

  /** @param {gdjs.RuntimeScene} runtimeScene */
  const loadScene = (runtimeScene) => {
    runtimeScene.loadFromScene({
      sceneData: {
        layers: [
          {
            name: '',
            visibility: true,
            effects: [],
            cameras: [],
            ambientLightColorR: 0,
            ambientLightColorG: 0,
            ambientLightColorB: 0,
            isLightingLayer: false,
            followBaseLayerCamera: true,
          },
        ],
        r: 0,
        v: 0,
        b: 0,
        mangledName: 'Scene1',
        name: 'Scene1',
        stopSoundsOnStartup: false,
        title: '',
        behaviorsSharedData: [],
        objects: [],
        objectsGroups: [],
        instances: [],
        variables: [],
        usedResources: [],
        uiSettings: {
          grid: false,
          gridType: 'rectangular',
          gridWidth: 10,
          gridHeight: 10,
          gridDepth: 10,
          gridOffsetX: 0,
          gridOffsetY: 0,
          gridOffsetZ: 0,
          gridColor: 0,
          gridAlpha: 1,
          snap: false,
        },
      },
      usedExtensionsWithVariablesData: [],
    });
  };

  /**
   * @param {'linear' | 'nearest'} scaleMode
   * @param {{characterSize?: number, bold?: boolean}=} objectOptions
   */
  const setUpObject = (scaleMode, objectOptions) => {
    const runtimeGame = gdjs.getPixiRuntimeGame({
      propertiesOverrides: { scaleMode },
    });
    const runtimeScene = new gdjs.RuntimeScene(runtimeGame);
    loadScene(runtimeScene);
    const object = makeTextRuntimeObject(runtimeScene, objectOptions);
    runtimeScene.addObject(object);
    // Simulate the first frame, which forces a re-rasterization of the text.
    object.updatePreRender(runtimeScene);

    const pixiText = /** @type {PIXI.Text} */ (object.getRendererObject());
    return { runtimeScene, object, pixiText };
  };

  /**
   * Scan the alpha channel of the canvas the text was rasterized on.
   * @param {PIXI.Text} pixiText
   */
  const getAlphaStats = (pixiText) => {
    const canvas = pixiText.canvas;
    const data = pixiText.context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    ).data;
    let opaqueCount = 0;
    let intermediateCount = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 255) opaqueCount++;
      else if (data[i] !== 0) intermediateCount++;
    }
    return {
      hasOpaque: opaqueCount > 0,
      hasIntermediate: intermediateCount > 0,
      intermediateRatio:
        intermediateCount + opaqueCount === 0
          ? 0
          : intermediateCount / (intermediateCount + opaqueCount),
    };
  };

  it('keeps the antialiasing of a small regular font (thresholding would make it unreadable)', () => {
    const { runtimeScene, pixiText } = setUpObject('nearest');

    // NEAREST sampling is applied to all texts of a "nearest" game...
    expect(pixiText.texture.baseTexture.scaleMode).to.be(
      PIXI.SCALE_MODES.NEAREST
    );
    // ...but a small regular font rasterizes with mostly partial-coverage
    // pixels: the de-antialiasing must be skipped to keep the text readable.
    const stats = getAlphaStats(pixiText);
    expect(stats.intermediateRatio).to.be.above(0.35);
    expect(stats.hasIntermediate).to.be(true);

    runtimeScene.unloadScene();
  });

  it('removes the font antialiasing when the rasterization is near-binary', () => {
    const { runtimeScene, pixiText } = setUpObject('nearest', {
      characterSize: 100,
      bold: true,
    });

    expect(pixiText.texture.baseTexture.scaleMode).to.be(
      PIXI.SCALE_MODES.NEAREST
    );
    // A big bold text has a low fraction of partial-coverage (edge) pixels,
    // so the thresholding is applied: all alpha values become 0 or 255.
    const { hasOpaque, hasIntermediate } = getAlphaStats(pixiText);
    expect(hasOpaque).to.be(true);
    expect(hasIntermediate).to.be(false);
    // No re-rasterization must be pending, as PixiJS would do it at render
    // time, restoring the antialiasing.
    expect(pixiText.dirty).to.be(false);

    runtimeScene.unloadScene();
  });

  it('keeps the text de-antialiased when the text is changed', () => {
    const { runtimeScene, object, pixiText } = setUpObject('nearest', {
      characterSize: 100,
      bold: true,
    });

    object.setText('Changed!');
    const { hasOpaque, hasIntermediate } = getAlphaStats(pixiText);
    expect(hasOpaque).to.be(true);
    expect(hasIntermediate).to.be(false);

    runtimeScene.unloadScene();
  });

  it('keeps the text de-antialiased when the style is changed', () => {
    const { runtimeScene, object, pixiText } = setUpObject('nearest', {
      characterSize: 100,
      bold: true,
    });

    object.setCharacterSize(72);
    const { hasOpaque, hasIntermediate } = getAlphaStats(pixiText);
    expect(hasOpaque).to.be(true);
    expect(hasIntermediate).to.be(false);
    expect(pixiText.dirty).to.be(false);

    runtimeScene.unloadScene();
  });

  it('does not change the text rendering when the game uses the "linear" scale mode', () => {
    const { runtimeScene, pixiText } = setUpObject('linear');

    expect(pixiText.texture.baseTexture.scaleMode).to.be(
      PIXI.SCALE_MODES.LINEAR
    );
    // The browser rasterizes canvas text with antialiasing: intermediate
    // alpha values must be present as they were not thresholded.
    const { hasIntermediate } = getAlphaStats(pixiText);
    expect(hasIntermediate).to.be(true);

    runtimeScene.unloadScene();
  });
});

// @ts-check

describe('gdjs.TextRuntimeObject (crisp rendering with "nearest" scale mode)', () => {
  /**
   * @param {gdjs.RuntimeScene} runtimeScene
   * @returns {gdjs.TextRuntimeObject}
   */
  const makeTextRuntimeObject = (runtimeScene) =>
    new gdjs.TextRuntimeObject(runtimeScene, {
      name: 'text1',
      type: 'TextObject::Text',
      variables: [],
      behaviors: [],
      effects: [],
      content: {
        characterSize: 20,
        font: '',
        bold: false,
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
   */
  const setUpObject = (scaleMode) => {
    const runtimeGame = gdjs.getPixiRuntimeGame({
      propertiesOverrides: { scaleMode },
    });
    const runtimeScene = new gdjs.RuntimeScene(runtimeGame);
    loadScene(runtimeScene);
    const object = makeTextRuntimeObject(runtimeScene);
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
    let hasOpaque = false;
    let hasIntermediate = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 255) hasOpaque = true;
      else if (data[i] !== 0) hasIntermediate = true;
    }
    return { hasOpaque, hasIntermediate };
  };

  it('removes the font antialiasing when the game uses the "nearest" scale mode', () => {
    const { runtimeScene, pixiText } = setUpObject('nearest');

    expect(pixiText.texture.baseTexture.scaleMode).to.be(
      PIXI.SCALE_MODES.NEAREST
    );
    const { hasOpaque, hasIntermediate } = getAlphaStats(pixiText);
    expect(hasOpaque).to.be(true);
    expect(hasIntermediate).to.be(false);

    runtimeScene.unloadScene();
  });

  it('keeps the text de-antialiased when the text is changed', () => {
    const { runtimeScene, object, pixiText } = setUpObject('nearest');

    object.setText('Changed!');
    const { hasOpaque, hasIntermediate } = getAlphaStats(pixiText);
    expect(hasOpaque).to.be(true);
    expect(hasIntermediate).to.be(false);

    runtimeScene.unloadScene();
  });

  it('keeps the text de-antialiased when the style is changed', () => {
    const { runtimeScene, object, pixiText } = setUpObject('nearest');

    // An odd character size maximizes the antialiasing done by the browser.
    object.setCharacterSize(31);
    const { hasOpaque, hasIntermediate } = getAlphaStats(pixiText);
    expect(hasOpaque).to.be(true);
    expect(hasIntermediate).to.be(false);
    // No re-rasterization must be pending, as PixiJS would do it at render
    // time, restoring the antialiasing.
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

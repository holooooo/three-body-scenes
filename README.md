# 三体 · 名场面复原 / Three-Body · Restored Scenes

作者：粑粑柑（梭哈ai版）

三个可以实时交互的 WebGL 复原场景，取材于刘慈欣《三体》三部曲：古筝行动、末日战役（水滴）、二向箔（太阳系二维化）。每个场景都是时间的纯函数，所以时间轴可以拖动、暂停、放慢，镜头随时可以接管。画面里没有血腥内容，也没有任何人物。

在线：https://three-body-scenes.pages.dev/ （镜像：https://holooooo.github.io/three-body-scenes/）

| 场景 | 链接 |
|---|---|
| 01 古筝行动 | [scene.html?s=guzheng](https://three-body-scenes.pages.dev/scene.html?s=guzheng) |
| 02 末日战役 | [scene.html?s=droplet](https://three-body-scenes.pages.dev/scene.html?s=droplet) |
| 03 二向箔 | [scene.html?s=foil](https://three-body-scenes.pages.dev/scene.html?s=foil) |

## 操作

- 拖动旋转，滚轮缩放，右键拖动平移。
- 空格暂停；←/→ 步进 2 秒（Shift 为 10 秒）；`[` `]` 调速。
- `C` 导演镜头 / 自由镜头；`H` 隐藏界面；`F` 全屏；数字键跳到关键时刻。
- URL 参数：`?lang=en|zh` 切换语言，`?q=low|medium|high` 调整画质。

## 技术

- three.js r187，放在 `vendor/three`，没有构建步骤，直接使用 ES modules 和 importmap。
- 画面全部由代码程序生成（几何体、着色器、粒子），不下载贴图或模型，也不使用任何影视素材。
- 目录：`src/core/`（引擎、后处理、界面外壳、星空）；`src/scenes/guzheng|droplet|foil/`（三个场景）；`src/film/`（逐帧精确的影片页面）；`films/cues/`（配乐提示单）；`tools/`（无头 Chrome 逐帧渲染、ffmpeg 合成、Python/numpy 程序化配乐）；`assets/`（海报图）；`brand/`（头像与图标）。

## 本地预览

```bash
node tools/serve.mjs . 8017
```

然后打开 http://127.0.0.1:8017/

## 渲染宣传短片（可选）

需要 Google Chrome、ffmpeg，以及装有 numpy 和 scipy 的 Python 3。

```bash
python3 tools/audio/score.py all
tools/make_film.sh guzheng      # 另有 droplet、foil
node tools/render.mjs --scene foil --stills 20,40   # 只截静帧
```

成片输出到 `out/`，中间文件在 `build/`，两者都不入库。

## 关于准确性

尺度和时间为了可看性做了压缩。例如末日战役在场景中只用约两分钟展开，二向箔里的行星大小也做了夸张。场景依据小说中的描写自行设计，并非对原作或任何影视改编的还原。

## License

代码使用 MIT 许可，见 [LICENSE](LICENSE)。three.js 使用其自身的 MIT 许可，见 `vendor/three/LICENSE`。`brand/` 中的头像是作者本人的图片，不在 MIT 许可范围内。

这是一份同人致敬作品，与刘慈欣、出版方及任何影视改编无关。

---

# Three-Body · Restored Scenes

By 粑粑柑（梭哈ai版）

Three interactive, real-time WebGL restorations of scenes from Liu Cixin's *Three-Body* trilogy: Operation Guzheng (古筝行动), the Doomsday Battle with the droplet (末日战役), and the two-dimensionalization of the Solar System (二向箔). Each scene is a pure function of time, so the timeline can be scrubbed, paused and slowed, and the camera can be taken over at any moment. No gore: no people are shown.

Online: https://three-body-scenes.pages.dev/ (mirror: https://holooooo.github.io/three-body-scenes/). Scenes: [guzheng](https://three-body-scenes.pages.dev/scene.html?s=guzheng), [droplet](https://three-body-scenes.pages.dev/scene.html?s=droplet), [foil](https://three-body-scenes.pages.dev/scene.html?s=foil).

## Controls

- Drag to orbit, scroll to zoom, right-drag to pan.
- Space pauses; ←/→ step 2 s (Shift for 10 s); `[` `]` change speed.
- `C` director / free camera; `H` hide UI; `F` fullscreen; number keys jump to key moments.
- URL parameters: `?lang=en|zh`, `?q=low|medium|high`.

## Tech

- three.js r187, vendored in `vendor/three`. No build step: ES modules and an importmap.
- Everything on screen is procedural (geometry, shaders, particles). No textures or models are downloaded, and no film or TV footage is used.
- Layout: `src/core/` (engine, post-processing, UI shell, starfield); `src/scenes/guzheng|droplet|foil/`; `src/film/` (frame-exact film page); `films/cues/` (music cue sheets); `tools/` (headless-Chrome frame renderer, ffmpeg mux, procedural score in Python/numpy); `assets/` (posters); `brand/` (avatar and icon).

## Local preview

```bash
node tools/serve.mjs . 8017
```

Then open http://127.0.0.1:8017/

## Rendering the showcase films (optional)

Needs Google Chrome, ffmpeg, and Python 3 with numpy and scipy.

```bash
python3 tools/audio/score.py all
tools/make_film.sh guzheng      # also droplet, foil
node tools/render.mjs --scene foil --stills 20,40   # stills only
```

Results go to `out/`, intermediate files to `build/`. Neither is committed.

## Accuracy notes

Scale and timing are compressed for legibility. In the droplet scene the whole battle plays out in about two minutes, and planet sizes in the foil scene are exaggerated. The scenes are original designs based on the novels' descriptions.

## License

Code is under MIT (see [LICENSE](LICENSE)). three.js is under its own MIT license in `vendor/three/LICENSE`. The avatar image in `brand/` is the author's and is not covered by the MIT license.

A fan tribute, not affiliated with the author, publishers or any screen adaptation.

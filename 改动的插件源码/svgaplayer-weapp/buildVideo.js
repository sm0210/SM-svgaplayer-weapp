/**
 * @author: SM
 * @desc: 单独压缩video_entity文件
 */
var browserify = require("browserify");
var tsify = require("tsify");
var tinyify = require("tinyify");

browserify({ standalone: "SVGA" })
  .add("./src/video_entity.ts")
  .plugin(tsify, { noImplicitAny: true })
  .plugin(tinyify, { flat: false })
  .bundle()
  .on("error", function (error) {
    console.error(error.toString());
  })
  .pipe(process.stdout);

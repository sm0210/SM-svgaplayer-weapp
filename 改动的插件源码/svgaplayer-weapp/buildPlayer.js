/**
 * @author: SM
 * @desc: 单独压缩Player文件
 */
var browserify = require("browserify");
var tsify = require("tsify");
var tinyify = require("tinyify");

browserify({ standalone: "SVGA" })
  .add("./src/player.ts")
  .plugin(tsify, { noImplicitAny: true })
  .plugin(tinyify, { flat: false })
  .bundle()
  .on("error", function (error) {
    console.error(error.toString());
  })
  .pipe(process.stdout);

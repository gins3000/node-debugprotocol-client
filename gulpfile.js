// @ts-check

const del = require("del");
const fs = require("mz/fs");
const path = require("path");
const merge = require("merge2");

const gulp = require("gulp");
const gulpTypescript = require("gulp-typescript");
const gulpSourcemaps = require("gulp-sourcemaps");

require("./build/generate-boilerplate");

function absolutePath(partialPath) {
  return path.resolve(process.cwd(), partialPath);
}

async function buildTypeScript() {
  const tsconfigPath = absolutePath("tsconfig.json");
  const tsConfig = JSON.parse(await fs.readFile(tsconfigPath, "utf8"));
  const outDir = absolutePath(tsConfig.compilerOptions.outDir);

  const tsProject = gulpTypescript.createProject(tsconfigPath);
  const tsResult = tsProject.src()
    .pipe(gulpSourcemaps.init())
    .pipe(tsProject());

  return new Promise((resolve, reject) => {
    merge([tsResult.js, tsResult.dts])
      .pipe(gulpSourcemaps.write('.', { sourceRoot: outDir }))
      .pipe(gulp.dest(outDir))
      .on("error", reject)
      .on("end", resolve);
  });
}

gulp.task("clean", () => del(["dist"]));
gulp.task("build", () => buildTypeScript());
gulp.task("watch", gulp.series(
  gulp.series("build"),
  () => {
    gulp.watch("src/**/*.ts", gulp.series("build"));
  })
);

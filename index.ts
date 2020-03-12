process.on("unhandledRejection", err => {
  throw err;
});

import fs from "fs-extra";
import path from "path";
import resizeImg from "resize-img";

const srcDir = "input";
const outputDir = "output";

async function resize(
  imageName: string,
  width: number = 512,
  height: number = 512
) {
  const srcImagePath = path.join(srcDir, imageName);
  const srcImage = await fs.readFile(srcImagePath);
  const image = await resizeImg(srcImage, {
    width,
    height
  });

  console.log(1);
  const outputImage = path.join(outputDir, imageName);
  console.log(2);
  await fs.writeFile(outputImage, image);
  return outputImage;
}

async function init() {
  await fs.ensureDir(outputDir);

  // get image
  const srcImage = "test.jpg";
  // remove background
  // resize image
  const resizedImage = await resize(srcImage);
  // send it back
  console.log(resizedImage);
}

init();

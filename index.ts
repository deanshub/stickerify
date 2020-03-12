process.on("unhandledRejection", err => {
  throw err;
});

import fs from "fs-extra";
import path from "path";
import request from "request";
import config from "config";
import resizeImg from "resize-img";
import TelegramBot from "node-telegram-bot-api";

const botToken: string = config.get("TELEGRAM_BOT_TOKEN");
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
  setupBot();
  await fs.ensureDir(outputDir);

  // // get image
  // const srcImage = "test.jpg";
  // // remove background
  // // resize image
  // const resizedImage = await resize(srcImage);
  // // send it back
  // console.log(resizedImage);
}

function download(uri: string, filename: string){
  return new Promise((resolve, reject)=>{
    request.head(uri, function(err, res){
      if (err) reject(err)
      console.log('content-type:', res.headers['content-type']);
      console.log('content-length:', res.headers['content-length']);

      request(uri).pipe(fs.createWriteStream(path.join(srcDir, filename))).on('close', ()=>resolve(filename));
    });
  })
};

function setupBot() {

  const bot = new TelegramBot(botToken, { polling: true });

  bot.onText(/\/start/, msg => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId, `Send me an image and I'll see what I can do`);
  });
  bot.on("photo", async msg => {
    const chatId = msg.chat.id;
    if (msg?.photo?.length??0>0){
      const largetPhoto = msg.photo!.reduce((res, img) => {
        if (img.width * img.height > res.width * res.height) {
          return img;
        }
        return res;
      }, msg.photo![0]);
      const photo = await bot.getFile(largetPhoto.file_id);
      const imageName = `${msg.chat.id}_${msg.message_id}.png`
      await download(`https://api.telegram.org/file/bot${botToken}/${photo.file_path}`, imageName)
      const resizedImage = await resize(imageName)
      bot.sendPhoto(chatId,resizedImage)
    }

    console.log(msg);
  });
}

init();

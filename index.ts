process.on("unhandledRejection", err => {
  throw err;
});

import fs from "fs-extra";
import path from "path";
import request from "request";
import config from "config";
import resizeImg from "resize-img";
import TelegramBot from "node-telegram-bot-api";
import { srcDir, outputDir } from "./constants";
import { loadImageCache, get, set } from "./imageCache";

const botToken: string = config.get("TELEGRAM_BOT_TOKEN");

async function resize(
  imageName: string,
  srcImage: Buffer,
  width: number = 512,
  height: number = 512
) {
  const image = await resizeImg(srcImage, {
    width,
    height
  });

  const outputImage = path.join(outputDir, imageName);
  await fs.writeFile(outputImage, image);
  return outputImage;
}

async function init() {
  await loadImageCache();
  setupBot();
  await fs.ensureDir(outputDir);
}

function download(uri: string, filename: string) {
  return new Promise((resolve, reject) => {
    request.head(uri, err => {
      if (err) reject(err);
      request(uri)
        .pipe(fs.createWriteStream(path.join(srcDir, filename)))
        .on("close", () => resolve(filename));
    });
  });
}

function removeBg(imageName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    request.post(
      {
        url: "https://api.remove.bg/v1.0/removebg",
        formData: {
          image_file: fs.createReadStream(path.join(srcDir, imageName)),
          size: "auto"
        },
        headers: {
          "X-Api-Key": config.get("REMOVE_BG_API_KEY")
        },
        encoding: null
      },
      function(error, response, body) {
        if (error) return reject(error);
        if (response.statusCode != 200) return reject(response);
        resolve(body);
      }
    );
  });
}

function setupBot() {
  const bot = new TelegramBot(botToken, { polling: true });

  bot.onText(/\/start/, msg => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId, `Send me an image and I'll see what I can do`);
  });

  bot.on("photo", async msg => {
    const chatId = msg.chat.id;
    if (msg?.photo?.length ?? 0 > 0) {
      const largetPhoto = msg.photo!.reduce((res, img) => {
        if (img.width * img.height > res.width * res.height) {
          return img;
        }
        return res;
      }, msg.photo![0]);
      const photo = await bot.getFile(largetPhoto.file_id);
      const imageName = `${msg.chat.id}_${msg.message_id}.png`;
      await download(
        `https://api.telegram.org/file/bot${botToken}/${photo.file_path}`,
        imageName
      );
      let outputImage = await get(imageName);
      if (!outputImage) {
        outputImage = path.join(outputDir, imageName);
        console.log(`"${imageName}" not loaded from cache`);
        const unbgImage = await removeBg(imageName);
        await resize(imageName, unbgImage);
        set(imageName);
      }

      bot.sendPhoto(chatId, outputImage);
      bot.sendDocument(chatId, outputImage);
    }

    // console.log(msg);
  });
}

init();

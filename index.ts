process.on('unhandledRejection', (err) => {
  throw err;
});

import fs from 'fs-extra';
import path from 'path';
import request from 'request';
import config from 'config';
import resizeImg from 'resize-img';
import TelegramBot from 'node-telegram-bot-api';
import { srcDir, outputDir } from './constants';
import { loadImageCache, get, set } from './imageCache';

const botToken: string = config.get('TELEGRAM_BOT_TOKEN');

async function resize(
  imageName: string,
  srcImage: Buffer,
  width: number = 512,
  height: number = 512,
) {
  const image = await resizeImg(srcImage, {
    width,
    height,
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
    request.head(uri, (err) => {
      if (err) reject(err);
      request(uri)
        .pipe(fs.createWriteStream(path.join(srcDir, filename)))
        .on('close', () => resolve(filename));
    });
  });
}

function removeBg(imageName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    request.post(
      {
        url: 'https://api.remove.bg/v1.0/removebg',
        formData: {
          image_file: fs.createReadStream(path.join(srcDir, imageName)),
          size: 'auto',
        },
        headers: {
          'X-Api-Key': config.get('REMOVE_BG_API_KEY'),
        },
        encoding: null,
      },
      function (error, response, body) {
        if (error) return reject(error);
        if (response.statusCode != 200) return reject(response);
        resolve(body);
      },
    );
  });
}

let cb: null | Function;
export function subscribeToMessages(bot: TelegramBot) {
  bot.on('message', async (msg) => {
    if (cb) {
      return cb(msg);
    }
  });
}

function getMessage(): Promise<TelegramBot.Message> {
  return new Promise((resolve, reject) => {
    const getMessageTimeout = setTimeout(() => {
      cb = null;
      reject(new Error('Message not received in time'));
    }, config.get('MESSAGE_RESULT_TIMEOUT'));
    cb = (msg: TelegramBot.Message) => {
      getMessageTimeout.unref();
      cb = null;
      resolve(msg);
    };
  });
}

let stickerMeassegeCallback:
  | ((msg: TelegramBot.Message, outputImage: string) => void)
  | null = null;
async function onPhoto(bot: TelegramBot, msg: TelegramBot.Message) {
  const chatId = msg.chat.id;
  try {
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
        imageName,
      );
      let outputImage = await get(imageName);
      if (!outputImage) {
        outputImage = path.join(outputDir, imageName);
        console.log(`"${imageName}" not loaded from cache`);
        const unbgImage = await removeBg(imageName);
        await resize(imageName, unbgImage);
        set(imageName);
      }

      if (stickerMeassegeCallback) {
        stickerMeassegeCallback(msg, outputImage);
      } else {
        await bot.sendSticker(chatId, outputImage);
      }
    }
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, `Couldn't transform this photo to sticker, sorry`);
  }
}

let clearMessageTimeoutId: NodeJS.Timeout;
function getStickerMessage(): Promise<{
  msg: TelegramBot.Message;
  outputImage: string;
}> {
  return new Promise((resolve, reject) => {
    clearMessageTimeoutId = setTimeout(() => {
      reject('Sticker message timeout');
      stickerMeassegeCallback = null;
    }, config.get('MESSAGE_RESULT_TIMEOUT'));
    stickerMeassegeCallback = (
      msg: TelegramBot.Message,
      outputImage: string,
    ) => {
      // clearTimeout(clearMessageTimeoutId);
      clearMessageTimeoutId.unref();
      stickerMeassegeCallback = null;
      resolve({ msg, outputImage });
    };
  });
}

function setupBot() {
  const bot = new TelegramBot(botToken, { polling: true });

  subscribeToMessages(bot);

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId, `Start a new sticker pack by running /set`);
  });

  bot.onText(/\/set/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const meMessage = await bot.getMe();

      // name
      await bot.sendMessage(
        chatId,
        `I'll create a new sticker set for you.
  What do you want me to call it?`,
      );
      const nameMessage = await getMessage();
      const stickerSetName = `${nameMessage.text}_by_${meMessage.username}`;
      let stickerSet;
      stickerSet = await (bot as any)
        .getStickerSet(stickerSetName)
        .catch(() => undefined);

      if (stickerSet) {
        // emoji
        await bot.sendMessage(chatId, 'What emoji do you want to set?');
        const emojiMessage = await getMessage();

        // image
        await bot.sendMessage(
          chatId,
          `Send me the image and I'll see what I can do`,
        );
        const stickerMessage = await getStickerMessage();

        const addedToStickerSetMessage = await (bot as any).addStickerToSet(
          msg.from?.id,
          stickerSetName,
          stickerMessage.outputImage,
          emojiMessage.text,
        );
        if (addedToStickerSetMessage) {
          stickerSet = await (bot as any).getStickerSet(stickerSetName);
          const sticker = stickerSet.stickers.find(
            (sticker: { emoji: string }) => sticker.emoji === emojiMessage.text,
          );
          bot.sendSticker(chatId, sticker.file_id);
        }
      } else {
        // title
        await bot.sendMessage(chatId, "What do you want it's title to be?");
        const titleMessage = await getMessage();

        // emoji
        await bot.sendMessage(chatId, 'What emoji do you want to set?');
        const emojiMessage = await getMessage();

        // image
        await bot.sendMessage(
          chatId,
          `Send me the image and I'll see what I can do`,
        );
        const stickerMessage = await getStickerMessage();
        const newStickerSetMessage = await (bot as any).createNewStickerSet(
          msg.from?.id,
          stickerSetName,
          titleMessage.text,
          stickerMessage.outputImage,
          emojiMessage.text,
        );
        if (newStickerSetMessage) {
          stickerSet = await (bot as any).getStickerSet(stickerSetName);
          const sticker = stickerSet.stickers.find(
            (sticker: { emoji: string }) => sticker.emoji === emojiMessage.text,
          );
          bot.sendSticker(chatId, sticker.file_id);
        }
      }
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, `Couldn't make you a sticker, I die now`);
    }
  });

  bot.on('photo', (msg) => onPhoto(bot, msg));
}

init();

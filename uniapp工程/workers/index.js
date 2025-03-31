/**
 * @author: SM
 * @desc: workers中处理小程序svga文件解析
 */
"use strict";
const { ProtoMovieEntity } = require("./protobuf.weapp")
const { inflate } = require("./pako");
const { VideoEntity }  = require("./video.weapp");
/**
 * 将 Uint8Array 转为 Base64 字符串
 * @param {*} uint8Array 
 * @returns 
 */
let uint8ArrayToBase64 = function (uint8Array){
  const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  const bytes = uint8Array;
  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;
  // 处理每3字节一组
  for (let i = 0; i < mainLength; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    base64 += BASE64_CHARS[(chunk >> 18) & 0x3F];
    base64 += BASE64_CHARS[(chunk >> 12) & 0x3F];
    base64 += BASE64_CHARS[(chunk >> 6) & 0x3F];
    base64 += BASE64_CHARS[chunk & 0x3F];
  }
  // 处理剩余1或2字节
  if (byteRemainder === 1) {
    const chunk = bytes[mainLength];
    base64 += BASE64_CHARS[(chunk >> 2) & 0x3F];
    base64 += BASE64_CHARS[(chunk << 4) & 0x3F];
    base64 += '==';
  } else if (byteRemainder === 2) {
    const chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];
    base64 += BASE64_CHARS[(chunk >> 10) & 0x3F];
    base64 += BASE64_CHARS[(chunk >> 4) & 0x3F];
    base64 += BASE64_CHARS[(chunk << 2) & 0x3F];
    base64 += '=';
  }
  return base64;
}

/**
 * 把svga图片转成base64
 * @param {*} data 
 * @returns 
 */
let loadWXImage = function(data){
  //
  return new Promise((res, rej) => {
    try{
      let base64 = "data:image/png;base64," + uint8ArrayToBase64(data);
      res(base64);
    }catch(e){
      console.log('获取图片base64失败,原因:', e);
      rej("image decoded fail.");
    }
  });
};

/**
 * worker接收主线程消息
 */
worker.onMessage(async (res) => {
  console.log("Worker线程收到信息:", res);
  // 二进制文件数据
  let { inflatedData } = res;
  //
  let movieData = ProtoMovieEntity.decode(inflate(inflatedData));
  // VideoEntity实体类
  let videoItem = new VideoEntity(movieData);
  // 如果存在数据
  let keyedImages = [];
  if(videoItem){
    keyedImages = await Promise.all(
      Object.keys(videoItem.spec.images).map(async (it) => {
        try {
          const data = await loadWXImage(videoItem.spec.images[it]);
          return { key: it, value: data };
        } catch (error) {
          return { key: it, value: undefined };
        }
      })
    );
    // let decodedImages = {};
    // keyedImages.forEach(function (it) {
    //   decodedImages[it.key] = it.value;
    // });
  }// end videoItem
  // 返回结果给主线程
  worker.postMessage({
    // decodedImages: decodedImages,
    keyedImages: keyedImages
  });
}); // enddd worker.onMessage

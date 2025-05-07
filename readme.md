- **解决问题相关技术点**:
  - 使用Worker多线程技术；
  - 改动插件源码，提取耗内存操作到Worker中处理；

- **一、起因**
项目基于uniapp需要在微信小程序播放svga文件，uniapp插件市场搜索后确定使用[c-svga](https://ext.dcloud.net.cn/plugin?id=10625)插件播放，该插件底层使用[svgaplayer-weapp](https://github.com/svga/svgaplayer-weapp)插件，但在使用的过程中发现在IOS小程序中当文件过大直接卡顿无法使用，官网[isuse](https://github.com/svga/svgaplayer-weapp/issues/20)也有人提出，至今没有解决，那关键时刻就只能靠自己了。

- **二、源码分析**
基于小程序架构设计(视图层和逻辑层)是不建议使用太消耗内存的操作，当深入分析svgaplayer-weapp插件源码分析后，发现吃内存的有两处,如下：
  -  loadWXImage方法中把文件流一帧一帧转成base64(见node_moudle/svgaplayer-weapp/src/player.ts);
  ![loadWXImage](https://upload-images.jianshu.io/upload_images/551421-fbc8ad068ccd9ed2.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/1240)

  - drawFrame 循环一帧一帧的base64绘制到canvas中(见node_moudle/svgaplayer-weapp/src/renderer.ts);
![drawFrame.png](https://upload-images.jianshu.io/upload_images/551421-4654ad09a15651db.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/1240)

- **三、解决问题**
 问题找到了就要想着解决，思路打开：当后台碰到消耗内存的操作都是启动多线程处理，想着能不能把前端消耗内存操作也放到多线程里解决呢？h5有Web Worker线程，那么小程序也对应有小程序的[Worker](https://developers.weixin.qq.com/miniprogram/dev/api/worker/wx.createWorker.html)线程，按照这个思路向下进行，那么需要解决如下问题：
  - 压缩svga文件；
  - 需要改c-svga插件中播放svga的代码；
  - 需要改svgaplayer-weapp插件中源码转成base64代码提取到Worker线程中；
  - 需要改svgaplayer-weapp插件drawFrame绘制代码提取到Worker线程中；(**因小程序canvas是基于客户端实现的并且提供了一系列的wx.xxx API操作，但是Worker中又不能使用wx.xxx Api**) 这步就只能放弃；
  - 读取本地文件增加缓存操作；
- **四、插件源码改造**
  - svgaplayer-weapp/src/parser.ts增加loadVideoEntity方法，把文件流转成VideoEntity实体类
````
 /**
   * SM ADD 把文件流转成VideoEntity对象 begin
   * @param data 
   * @returns 
   */
  loadVideoEntity(data: any): Promise<VideoEntity> {
    // console.log('loadVideoEntity  ==== ', data);
    return new Promise((resolver, rejector) => {
      try {
        const inflatedData = inflate(data as any);
        const movieData = ProtoMovieEntity.decode(inflatedData);
        resolver(new VideoEntity(movieData));
      } catch (error) {
        rejector(error);
      }
    })
  }
  // SM ADD 把文件流转成VideoEntity对象 end
````
  - svgaplayer-weapp/src/player.ts增加setVideoItemBase64和loadWXImageImage方法,主要作用就是把接受Worker中处理好的base64对象再转成img对象给canvas绘制
````
/**
   *  SM ADD begin 把base64转成img
   * @param videoItem 
   * @param keyedImages 
   */
  async setVideoItemBase64(videoItem?: VideoEntity, keyedImages?: any): Promise<any>{
    this._currentFrame = 0;
    this._videoItem = videoItem;
    if (videoItem) {
      //
      let decodedImages: { [key: string]: any } = {};
      keyedImages.forEach(async (it: any) => {
        decodedImages[it.key] = await this.loadWXImageImage(it.value);
      });
      videoItem.decodedImages = decodedImages;
      //
      // console.log('设置完成后图像信息:', videoItem.decodedImages);
      //
      this._renderer = new Renderer(this._videoItem!, this.ctx!, this.canvas!);
    }else{
      this._renderer = undefined;
    }
    this.clear();
    this._update();
  } 
  /**
   * SM ADD 把base64转成img对象
   * @param data 
   * @returns 
   */
  loadWXImageImage(data: string): Promise<any> {
    if (!this.canvas) throw "no canvas";
    return new Promise((res, rej) => {
      const img: WechatMiniprogram.Image = this.canvas!.createImage();
      img.onload = () => {
        res(img);
      };
      img.onerror = (error) => {
        console.log(error);
        rej("image decoded fail.");
      };
        img.src = data;
    });
  }
  // SM ADD begin 把base64转成img
````
  - src/uni_modules/c-svga/components/c-svga/c-svga.vue中改造，并且使用Worker
````
<template>
    <!-- #ifdef H5||APP-PLUS -->
    <view class="c-svga" :style="{width,height}" :svgaData="svgaData" :change:svgaData="svga.render" :fun='fun' :change:fun='svga.callPlayer'>
        <div :id='myCanvasId'></div>
    </view>
    <!-- #endif -->
    <!-- #ifdef MP -->
        <view class="c-svga" >
            <canvas class="canvas" :id="myCanvasId" type="2d"></canvas>
        </view>
    <!-- #endif -->
</template>
<script>
    /**
     * c-svga svga组件
     * @property {String} canvasId 画布id
     * @property {String} width 图像宽度 默认750rpx 单位rpx/px
     * @property {String} height 图像高度 默认750rpx 单位rpx/px
     * @property {String} src svga文件地址
     * @property {Boolean} autoPlay 是否自动播放 默认true
     * @property {Number} loops 动画循环次数，默认值为 0，表示无限循环
     * @property {Boolean} clearsAfterStop 默认值为 true，表示当动画结束时，清空画布
     * @property {String} fillMode 默认值为 Forward，可选值 Forward / Backward，当 clearsAfterStop 为 false 时，Forward 表示动画会在结束后停留在最后一帧，Backward 则会在动画结束后停留在第一帧。
     * @property {Boolean} isOnChange 是否开启播放进度监听 默认false false时不触发Frame Percentage监听
     * @event {Function()} loaded 监听svga文件加载完成
     * @event {Function()} finished 监听动画停止播放 loop!=0时生效
     * @event {Function()} frame 监听动画播放至某帧
     * @event {Function()} percentage 监听动画播放至某进度
     * 组件内方法统一使用 call(funName, args) 调用player实例方法 详见文档
     * */
    import uuid from './js/uuid.js'
    // import { Parser,Player} from 'svgaplayer-weapp/dist/svgaplayer.weapp.src.js'
    import { Parser,Player } from 'svgaplayer-weapp'
    //
    let workers = '';
    // wx.createWorker('workers/index.js');
    //
    export default {
        name:"c-svga",
        props: {
            canvasId: {
                type: String
            },
            width: {
                type: String,
                default: '100%'
            },
            height: {
                type: String,
                default: '100%'
            },
            src: {
                type: String,
                required: true
            },
            autoPlay: { //是否自动播放
                type: Boolean,
                default: true
            },
            loops: { //动画循环次数，默认值为 0，表示无限循环。
                type: Number,
                default: 0
            },
            clearsAfterStop: { //默认值为 true，表示当动画结束时，清空画布。
                type: Boolean,
                default: true
            },
            fillMode: { //默认值为 Forward，可选值 Forward / Backward，当 clearsAfterStop 为 false 时，Forward 表示动画会在结束后停留在最后一帧，Backward 则会在动画结束后停留在第一帧。
                type: String,
                default: 'Forward'
            },
            contentMode: { // 默认值mode: "Fill" | "AspectFill" | "AspectFit"
                type: String,
                default: 'Fill'
            },
            isOnChange: {
                type: Boolean,
                default: false
            }
        },
        emits: ['loaded', 'finished', 'frame', 'percentage'],
        data() {
            return {
                // 缓存礼物特效数据
                cacheGiftObj: {},
                //
                fun:{}
            }
        },
        computed: {
            myCanvasId() {
                if (!this.canvasId) {
                    return 'c' + uuid(18)
                } else {
                    return this.canvasId
                }
            },
            svgaData(){
                return {
                    myCanvasId: this.myCanvasId,
                    width: this.width,
                    height:this.height,
                    src: this.src,
                    autoPlay:this.autoPlay,
                    loops: this.loops,
                    clearsAfterStop:this.clearsAfterStop,
                    fillMode:this.fillMode,
                    isOnChange:this.isOnChange
                }
            }
        },
        watch:{
            svgaData(){
                // #ifdef MP
                this.render()
                // #endif
            }
        },
        methods: {
            call(name, args) {
                this.fun = {name,args}
                // #ifdef MP
                this.callPlayer(this.fun)
                // #endif
            },
            // #ifdef MP
            getContext(){
                return new Promise((resolve) => {
                    const {
                        pixelRatio
                    } = uni.getSystemInfoSync()

                    uni.createSelectorQuery()
                        .in(this)
                        .select(`#${this.myCanvasId}`)
                        .fields({
                            node: true,
                            size: true
                        })
                        .exec(res => {
                            const {
                                width,
                                height
                            } = res[0]
                            const canvas = res[0].node;
                            // console.log('canvas ==== ', canvas);
                            resolve({
                                canvas,
                                width,
                                height,
                                pixelRatio
                            })
                        })
                })
            },
            /**
             * SunMeng ADD 读取文件流
             */
            getFileSystemManager(src){
                //
                return new Promise((resolver, rej) => {
                    let url =  src || this.src;
                    let cacheItem = this.cacheGiftObj[url];
                    console.log('cacheItem ==== ', cacheItem);
                    if(cacheItem){
                        console.log('缓存读取文件!');
                        let inflatedData = cacheItem.data;
                        resolver(inflatedData);
                    }else{
                        console.log('本地读取文件!');
                        wx.getFileSystemManager().readFile({
                            filePath: url,
                            success: async (res) => {
                                //
                                let inflatedData = res.data;
                                // 存入缓存
                                this.cacheGiftObj[url] = { data: inflatedData }
                                //
                                resolver(inflatedData);
                            },
                            fail: (err)=>{
                                resolver('');
                            }
                        });
                    }

                    
                });// end Promise
            },
            /**
             * 事件处理
             */
            playerEvent(){
                this.$emit('loaded')
                if (this.autoPlay) {
                    this.player.startAnimation();
                }
                this.player.onFinished(() => { //只有在loop不为0时候触发
                    // console.log('动画停止播放时回调');
                    this.$emit('finished');
                })
                if (this.isOnChange) {
                    this.player.onFrame(frame => { //动画播放至某帧后回调
                        // console.log(frame);
                        try {
                            this.$emit('frame', frame)
                        } catch (e) {
                            //TODO handle the exception
                            console.error('err frame', e);
                        }
                    });
                    // 动画播放至某进度后回调
                    this.player.onPercentage(percentage => { 
                        // console.log(percentage);
                        try {
                            this.$emit('percentage', percentage)
                        } catch (e) {
                            //TODO handle the exception
                            console.error('percentage', e);
                        }
                    });
                }// end if
            },
            async render(){
                if(!this.src) return
                if (!this.player) {
                    this.parser = new Parser;
                    this.player = new Player;
                    await this.player.setCanvas('#' +this.myCanvasId,this)
                }
                this.player.stopAnimation()
                this.player.setContentMode(this.contentMode)
                this.player.loops = this.loops
                this.player.clearsAfterStop = this.clearsAfterStop
                this.player.fillMode = this.fillMode
                // console.time("test");
                // 安卓走原来代码,ios会有卡顿特殊处理
                // console.log('uni.getSystemInfoSync().platform === ', uni.getSystemInfoSync().platform);
                if (uni.getSystemInfoSync().platform === 'ios' || uni.getSystemInfoSync().platform === 'devtools') {
                    // SunMeng ADD 处理IOS卡顿问题
                    // 先从缓冲中判断是否存在
                    // let cacheItem = this.cacheGiftObj[this.src];
                    // console.log('cacheItem ==== ', cacheItem);
                    // if(cacheItem){
                    //  console.log('缓存中存在数据,使用缓存播放礼物特效!');
                    //  //
                    //  let { videoItem, keyedImages } = cacheItem;
                    //  await this.player.setVideoItemBase64(videoItem, keyedImages);
                    //  // 事件处理 
                    //  this.playerEvent();
                    // }else{
                        // console.log('缓存中没有数据,使用worker线程处理!');
                        let inflatedData = await this.getFileSystemManager(this.src);
                        if(inflatedData){
                            // console.log("获取到本地文件数据!");
                            // 二进制数据转成VideoEntity类型
                            let videoItem = await this.parser.loadVideoEntity(inflatedData);
                            console.log('VideoEntity文件数据类型!');
                            //works异步处理begin
                            if(!workers){
                                wx.preDownloadSubpackage({
                                    packageType: "workers", 
                                    success :(res)=> {
                                        console.log('下载workers分包成功!');
                                        workers = wx.createWorker('workers/index.js');
                                        // 二进制数据传入workers中置换base64
                                        workers.postMessage({ inflatedData: inflatedData });
                                        // 监听worker子线程返回数据
                                        workers.onMessage(async (res) => {
                                            console.log('worker子线程返回数据!');
                                            // 使用后及时销毁 Worker
                                            workers.terminate();
                                            workers = null;
                                            //
                                            let keyedImages = res.keyedImages;
                                            //
                                            await this.player.setVideoItemBase64(videoItem, keyedImages);
                                            // 存入缓存中
                                            // this.cacheGiftObj[this.src] = { videoItem, keyedImages };
                                            // 事件处理 
                                            this.playerEvent();
                                        });// end workers.onMessage
                                    },
                                    fail :(err)=> {
                                        console.log('下载workers分包失败:', err);
                                    }
                                });// end preDownloadSubpackage
                            }// end if workers
                        }else{
                            // 读取本地文件失败处理...
                        } // end getFileSystemManager
                    // }// end cache
                }else{
                    const videoItem = await this.parser.load(this.src);
                    await this.player.setVideoItem(videoItem);
                    // 事件处理 
                    this.playerEvent();
                } // end 设备判断

                // old code
                // console.timeEnd("test");
                // this.$emit('loaded')
                // if (this.autoPlay) {
                //  this.player.startAnimation();
                // }
                // this.player.onFinished(() => { //只有在loop不为0时候触发
                //  // console.log('动画停止播放时回调');
                //  this.$emit('finished')
                // })
                // if (this.isOnChange) {
                //  this.player.onFrame(frame => { //动画播放至某帧后回调
                //      // console.log(frame);
                //      try {
                //          this.$emit('frame', frame)
                //      } catch (e) {
                //          //TODO handle the exception
                //          console.error('err frame', e);
                //      }
                //  })
                //  this.player.onPercentage(percentage => { //动画播放至某进度后回调
                //      // console.log(percentage);
                //      try {
                //          this.$emit('percentage', percentage)
                //      } catch (e) {
                //          //TODO handle the exception
                //          console.error('percentage', e);
                //      }
                //  })
                // }
            },
            callPlayer(val){
                if (!val.name) return;
                let {
                    name,
                    args
                } = val
                // console.log(name, args);
                if (Array.isArray(args)) {
                    this.player[name](...args)
                } else {
                    this.player[name](args)
                }
            },
            // #endif
            // #ifndef MP
            receiveRenderData(val) {
                // console.log(val);
                this.$emit(val.name, val.val)
            }
            // #endif
        },
        mounted() {
            // #ifdef MP
            this.render()
            // #endif
        },
        onBeforeDestroy() {
            // #ifdef MP
            this.player.stopAnimation()
            this.player.clear()
            this.parser = null
            this.player = null
            this.cacheGiftObj = {}
            // #endif
        },
    }
</script>


<!-- #ifndef MP -->

    <!-- #ifdef VUE3 -->
    <script lang="renderjs" src='./js/render.js' module='svga'></script>
    <!-- #endif -->
    
    <!-- #ifdef VUE2 -->
    <script lang="renderjs" module='svga'>
    import svgaRender from "./js/render.js"
    export default {
        mixins:[svgaRender]
    }
    </script>
    <!-- #endif -->

    
<!-- #endif -->
<style lang="scss" scoped>
    .c-svga {
        width: 100%;
        height: 100%;
        // width: v-bind(width);
        // height: v-bind(height);

        /* #ifndef MP */
        div {
            width: 100%;
            height: 100%;
        }

        /* #endif */

        .canvas {
            width: 100%;
            height: 100%;
        }
    }
</style>
````
  - Worker代码，项目根目录创建workers目录并创建index.js
  ````
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
  ````
  - src/manifest.json中mp-weixin增加workers配置
  ````
  "mp-weixin" : {
        "workers" : {
            "path" : "workers",  // workers文件目录
            "isSubpackage" : true  // 启用分包处理
        },
    ......忽略其它相关配置
  ````
- 结案陈词
改动后的代码在IOS中测试已经明显没有卡顿现象能正常使用了，问题解决，完美～～～～


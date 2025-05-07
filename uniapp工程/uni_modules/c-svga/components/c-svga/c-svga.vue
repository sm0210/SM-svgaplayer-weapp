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

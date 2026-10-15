import { vertex, fragment } from './ocean.js';
const canvas = document.querySelector('#water');
const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
const notice = document.querySelector('#notice');
function notify(message) { notice.textContent = message; notice.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => notice.hidden = true, 5000); }
let program, uniforms, texture, ready = false, needsDraw = true, elapsed = 0, last = 0;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
const bedImage = new Image();
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
function uploadTexture(){
 gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,bedImage);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.uniform1i(uniforms.bed,0);gl.uniform2f(uniforms.imageSize,bedImage.naturalWidth,bedImage.naturalHeight);ready=true;needsDraw=true;canvas.hidden=false;
}
function init(){
 program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
 gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
 uniforms=Object.fromEntries(['resolution','time','imageSize','bed'].map(k=>[k,gl.getUniformLocation(program,k)]));texture=gl.createTexture();
 if(bedImage.complete && bedImage.naturalWidth)uploadTexture();
}
function resize(){needsDraw=true;const ratio=Math.min(devicePixelRatio||1,1.5,1920/innerWidth);canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(innerHeight*ratio);if(gl)gl.viewport(0,0,canvas.width,canvas.height);}
function frame(now){const dt=Math.min((now-last)/1000||0,.05);last=now;if(!document.hidden && ready && (!paused || needsDraw) && !gl.isContextLost()){if(!paused)elapsed+=dt;gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);gl.uniform1f(uniforms.time,elapsed);gl.drawArrays(gl.TRIANGLES,0,6);needsDraw=false;}requestAnimationFrame(frame);}
let initialized=false;
bedImage.onload=()=>{try{if(initialized)uploadTexture();}catch(error){canvas.hidden=true;console.error(error);notify('정적인 풍경을 표시합니다.');}};bedImage.onerror=()=>notify('바다 이미지를 불러오지 못했어요. 새로고침해 주세요.');
try{if(!gl)throw new Error('WebGL unavailable');init();initialized=true;resize();requestAnimationFrame(frame);}catch(error){canvas.hidden=true;console.error(error);notify('이 브라우저에서는 정적인 풍경을 표시합니다.');}
bedImage.src=new URL('./assets/seabed.png',import.meta.url).href;
addEventListener('resize',resize);
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();ready=false;canvas.hidden=true;});
canvas.addEventListener('webglcontextrestored',()=>{try{init();resize();}catch{canvas.hidden=true;notify('화면을 새로고침해 주세요.');}});
function updatePause(){const button=document.querySelector('#pause');button.setAttribute('aria-label',paused?'물결 재생':'물결 일시정지');button.title=paused?'재생':'일시정지';document.querySelector('#pause-path').setAttribute('d',paused?'m8 5 11 7-11 7Z':'M9 5v14M15 5v14');}
document.querySelector('#pause').addEventListener('click',()=>{paused=!paused;needsDraw=true;updatePause();});updatePause();
let idleTimer;
function showControls(){document.body.classList.remove('idle');clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(!document.querySelector('.controls').contains(document.activeElement))document.body.classList.add('idle');},2600);}
addEventListener('pointermove',showControls,{passive:true});addEventListener('pointerdown',showControls,{passive:true});addEventListener('keydown',showControls);showControls();
document.querySelector('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else notify('이 브라우저는 전체 화면을 지원하지 않아요.');}catch{notify('전체 화면을 열 수 없어요.');}});
let audio,audioGain,soundOn=false;
function createWaterAudio(){
 audio=new(window.AudioContext||window.webkitAudioContext)();audioGain=audio.createGain();audioGain.gain.value=0;audioGain.connect(audio.destination);
 const buffer=audio.createBuffer(2,audio.sampleRate*8,audio.sampleRate);
 for(let channel=0;channel<2;channel++){const data=buffer.getChannelData(channel);let brown=0;for(let i=0;i<data.length;i++){brown=(brown+Math.random()*.04-.02)/1.02;data[i]=brown*4;}}
 const source=audio.createBufferSource();source.buffer=buffer;source.loop=true;const filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1100;source.connect(filter);filter.connect(audioGain);source.start();
 const lfo=audio.createOscillator();lfo.frequency.value=.17;const modulation=audio.createGain();modulation.gain.value=180;lfo.connect(modulation);modulation.connect(filter.frequency);lfo.start();
}
document.querySelector('#sound').addEventListener('click',async()=>{try{if(!audio)createWaterAudio();await audio.resume();soundOn=!soundOn;audioGain.gain.setTargetAtTime(soundOn?.42:0,audio.currentTime,.5);const button=document.querySelector('#sound');button.setAttribute('aria-pressed',String(soundOn));button.setAttribute('aria-label',soundOn?'물소리 끄기':'물소리 켜기');}catch{notify('이 브라우저에서는 물소리를 재생할 수 없어요.');}});
document.addEventListener('visibilitychange',()=>{if(audio){if(document.hidden)audio.suspend();else if(soundOn)audio.resume().catch(()=>{});}});

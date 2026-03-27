import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

/** @param {HTMLCanvasElement} canvas  */
async function initWebGPU(canvas) {
  if (!navigator.gpu) {
    throw Error("WebGPU not supported.");
  }
  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (error) {
    console.error(error);
  }
  if (!adapter) {
    throw Error("Couldn't request WebGPU adapter.");
  }
  const device = await adapter.requestDevice();

  /** @type {GPUCanvasContext} */
  const canvasContext = canvas.getContext("webgpu")
  canvasContext.configure({
    device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: "premultiplied",
  });

  return {
    device: device,
    context: canvasContext,
  };
}

const triangleShaders = /*wgsl*/ `
  struct VertexOut {
    @builtin(position) position : vec4f,
    @location(0) color : vec3f,
  };

  struct Uniforms {
    resolution : vec2f,
    time : f32,
  }

  @group(0) @binding(0) var<uniform> uniforms : Uniforms;

  fn rot2d(time : f32) -> mat2x2<f32> {
    return mat2x2<f32>(cos(time), sin(time), -sin(time), cos(time));
  }

  @vertex
  fn vertex_main(@location(0) position : vec3f,
                 @location(1) color : vec3f) -> VertexOut {
    var output : VertexOut;
    let reso : vec2f = uniforms.resolution;
    let minres : f32 = min(reso.x, reso.y);
    let worldpos = rot2d(uniforms.time) * position.xy  + vec2f(0, -.8);
    let screenpos = worldpos * minres / reso;
    output.position = vec4f(screenpos, 0.99, 1);
    output.color = color;
    return output;
  }

  @fragment
  fn fragment_main(@location(0) color : vec3f) -> @location(0) vec4f {
    return vec4f(color, 1);
  }
`;

let depthTexture
/** @param {HTMLCanvasElement} canvas */
function resizeGPUCanvas(canvas, device) {
  canvas.width = document.documentElement.clientWidth
  canvas.height = document.documentElement.clientHeight
  depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  })
}

async function main() {
  // Get DOM elements
  /** @type {HTMLCanvasElement} */
  const canvas = document.querySelector("#gpu-canvas")
  console.log(canvas)

  const perfData = {
    renderTimes: []
  }
  const perfElements = {
    /** @type {HTMLParagraphElement} */
    renderTimeAvg: document.querySelector("#render-time-avg"),
    renderTimeMax: document.querySelector("#render-time-max"),
    renderTimeMin: document.querySelector("#render-time-min"),
  }

  // Init webgpu
  const { device, context } = await initWebGPU(canvas);
  console.log(device, context);

  window.addEventListener("resize", () => resizeGPUCanvas(canvas, device))
  resizeGPUCanvas(canvas, device)

  // Create shader module
  const triangleShaderModule = device.createShaderModule({ code: triangleShaders });

  // Create vertex buffer layout
  /** @type {GPUVertexBufferLayout} */
  const vertexBufferLayouts = {
    arrayStride: 32, // eight floats
    stepMode: "vertex",
    attributes: [
      {
        format: "float32x4",
        offset: 0,
        shaderLocation: 0,
      },
      {
        format: "float32x3",
        offset: 16,
        shaderLocation: 1,
      },
    ],
  }

  // Create render pipeline
  const trianglePipeline = device.createRenderPipeline({
    vertex: {
      module: triangleShaderModule,
      entryPoint: "vertex_main",
      buffers: [vertexBufferLayouts],
    },
    fragment: {
      module: triangleShaderModule,
      entryPoint: "fragment_main",
      targets: [
        { format: navigator.gpu.getPreferredCanvasFormat() },
      ],
    },
    layout: "auto",
    
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    }
  });

  // Create vertex buffer
  const triangleVertexBufferData = new Float32Array([
    -0.43301, -0.25, 0, 1,
    1, 0, 0, 0,

    0.43301, -0.25, 0, 1,
    0, 1, 0, 0,

    0, 0.5, 0, 1,
    0, 0, 1, 0,
  ])
  const triangleVertexBuffer = device.createBuffer({
    size: triangleVertexBufferData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(triangleVertexBuffer, 0, triangleVertexBufferData);
  
  
  // counter-clockwise triangle list with vertices and normals
  // assuming x-right, y-up, and z-out (right-handed coords)
  const boxVertexBufferData = new Float32Array([
    // z = 0
    0, 0, 0, 1,     0, 0, -1, 0,
    0, 1, 0, 1,     0, 0, -1, 0,
    1, 0, 0, 1,     0, 0, -1, 0,
    1, 0, 0, 1,     0, 0, -1, 0,
    0, 1, 0, 1,     0, 0, -1, 0,
    1, 1, 0, 1,     0, 0, -1, 0,
    // z = 1
    0, 0, 1, 1,     0, 0, 1, 0,
    1, 0, 1, 1,     0, 0, 1, 0,
    0, 1, 1, 1,     0, 0, 1, 0,
    0, 1, 1, 1,     0, 0, 1, 0,
    1, 0, 1, 1,     0, 0, 1, 0,
    1, 1, 1, 1,     0, 0, 1, 0,
    // y = 0
    0, 0, 0, 1,     0, -1, 0, 0,
    1, 0, 0, 1,     0, -1, 0, 0,
    0, 0, 1, 1,     0, -1, 0, 0,
    0, 0, 1, 1,     0, -1, 0, 0,
    1, 0, 0, 1,     0, -1, 0, 0,
    1, 0, 1, 1,     0, -1, 0, 0,
    // y = 1
    0, 1, 0, 1,     0, 1, 0, 0,
    0, 1, 1, 1,     0, 1, 0, 0,
    1, 1, 0, 1,     0, 1, 0, 0,
    1, 1, 0, 1,     0, 1, 0, 0,
    0, 1, 1, 1,     0, 1, 0, 0,
    1, 1, 1, 1,     0, 1, 0, 0,
    // x = 0
    0, 0, 0, 1,     -1, 0, 0, 0,
    0, 0, 1, 1,     -1, 0, 0, 0,
    0, 1, 0, 1,     -1, 0, 0, 0,
    0, 1, 0, 1,     -1, 0, 0, 0,
    0, 0, 1, 1,     -1, 0, 0, 0,
    0, 1, 1, 1,     -1, 0, 0, 0,
    // x = 1
    1, 0, 0, 1,     1, 0, 0, 0,
    1, 1, 0, 1,     1, 0, 0, 0,
    1, 0, 1, 1,     1, 0, 0, 0,
    1, 0, 1, 1,     1, 0, 0, 0,
    1, 1, 0, 1,     1, 0, 0, 0,
    1, 1, 1, 1,     1, 0, 0, 0,
  ])
  const boxVertexBuffer = device.createBuffer({
    size: boxVertexBufferData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(boxVertexBuffer, 0, boxVertexBufferData);
  const boxShaderModule = device.createShaderModule({
    code: /* wgsl */`
      struct VertexOut {
        @builtin(position) ndcPos : vec4f,
        @location(0) worldPos : vec3f,
        @location(1) worldNormal : vec3f,
        @location(2) objPos : vec3f,
      }

      struct Uniforms {
        M : mat4x4<f32>, // object to world
        V : mat4x4<f32>, // world to view
        P : mat4x4<f32>, // view to NDC
        V_inv : mat4x4<f32>, // view to world
        time : f32,
      }
      @group(0) @binding(0) var<uniform> u : Uniforms;

      @vertex
      fn vertex_main(
        @location(0) position : vec4f,
        @location(1) normal : vec3f,
      ) -> VertexOut {
        let worldPos = u.M * position;
        let worldNormal = u.M * vec4f(normal, 0);
        var ndcPos = u.P * u.V * worldPos;
        // ndcPos /= ndcPos.w; // Don't perform perspective divide, hardware needs the w!
        return VertexOut(
          ndcPos,
          worldPos.xyz, // w should be 1
          worldNormal.xyz, // w should be 0
          position.xyz // w should be 0
        );
      }

      fn max3(v: vec3f) -> f32 { return max(v.x, max(v.y, v.z)); }

      fn sdBox(pos: vec3f, size: vec3f) -> f32 {
        let allAxes = abs(pos) - size;
        let positives = max(allAxes, vec3f(0, 0, 0));
        let negatives = min(allAxes, vec3f(0, 0, 0));
        return length(positives) + max3(negatives);
      }

      fn sdScene(pos: vec3f) -> f32 {
        let boxCenter = vec3f(sin(u.time), 0, 0);
        return sdBox(pos - boxCenter, vec3f(0.5, 0.5, 0.5));
      }

      @fragment
      fn fragment_main(
        @builtin(position) ndcPos : vec4f,
        @location(0) worldPos : vec3f,
        @location(1) worldNormal : vec3f,
        @location(2) objPos : vec3f,
      ) -> @location(0) vec4f {
        var eye = vec3f(0, 0, 0); // view-space eye coords
        eye = (u.V_inv * vec4f(eye, 1)).xyz; // world-space eye coords
        var color = vec3f(0.8, 0.8, 1);

        // Loop constants
        let raydir : vec3f = normalize(worldPos - eye);
        const numIter : u32 = 100;
        const eps : f32 = 0.01;

        // Loop variables
        // var t: f32 = distance(eye, worldPos);
        var t: f32 = 0;
        var hit: bool = false;

        for (var i: u32 = 0; i < numIter; i++) {
          let pos = eye + raydir * t;
          let dist = sdScene(pos);
          if (abs(dist) < eps) {
            hit = true;
            break;
          }
          t += dist;
        }

        if (hit) {
          color = abs(raydir);
        }

        return vec4f(color, 1);
      }
    `,
  })
  const boxPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: boxShaderModule,
      entryPoint: "vertex_main",
      buffers: [vertexBufferLayouts],
    },
    fragment: {
      module: boxShaderModule,
      entryPoint: "fragment_main",
      targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    }
  })

  const timeStart = performance.now() / 1000.
  let time = 0;

  function update() {
    const now = performance.now() / 1000. // time in seconds
    time = now - timeStart;
  }

  // Create uniform buffer
  const uniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: "triangle-uniform-buffer"
  })

  const uniformBindGroupLayout = trianglePipeline.getBindGroupLayout(0)
  const uniformBindGroup = device.createBindGroup({
    entries: [{ binding: 0, resource: uniformBuffer }],
    layout: uniformBindGroupLayout,
  })

  const boxUniformBuffer = device.createBuffer({
    size: 16 * 4 * 4 + 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: "box-uniform-buffer"
  })
  // float offsets, not byte offsets
  const boxUniformBufferFloatOffsets = {
    time: 16 * 4,
  }
  const boxUniformBindGroup = device.createBindGroup({
    entries: [{ binding: 0, resource: boxUniformBuffer }],
    layout: boxPipeline.getBindGroupLayout(0)
  })

  console.log(mat4)

  function render() {
    // Prepare render target
    const canvasTexture = context.getCurrentTexture()
    const canvasTextureView = canvasTexture.createView()

    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
      canvas.width,
      canvas.height,
      time,
    ]))

    const boxUniformBufferData = new Float32Array(16*4 + 4)
    const worldToView = mat4.lookAt(
      [3, 3, 3],     // position
      [0, 0, 0],     // target
      [0, 1, 0],     // up
    )
    const viewToWorld = mat4.inverse(worldToView)
    const boxMVP = [
      [
        mat4.scaling([2, 2, 2]),
        mat4.rotationY(time),
        mat4.translation([-0.5, -0.5, -0.5]),
      ].reduce((a, b) => mat4.multiply(a, b)),
      worldToView,
      mat4.perspective(3.1415 / 3, canvas.width / canvas.height, 0.5, 100),
      viewToWorld
    ]
    boxMVP.forEach((m, i) => {
      boxUniformBufferData.set(m, i * m.length)
    })
    boxUniformBufferData.set([time], boxUniformBufferFloatOffsets.time)
    device.queue.writeBuffer(boxUniformBuffer, 0, boxUniformBufferData)

    // Record commands and submit
    const commandEncoder = device.createCommandEncoder()
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          loadOp: "clear",
          storeOp: "store",
          view: canvasTextureView,
          clearValue: [0, 0, 0, 1],
        }
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    })
    // draw triangle
    passEncoder.setPipeline(trianglePipeline)
    passEncoder.setVertexBuffer(0, triangleVertexBuffer, 0, triangleVertexBuffer.size);
    passEncoder.setBindGroup(0, uniformBindGroup)
    // passEncoder.draw(3);

    // draw box
    passEncoder.setPipeline(boxPipeline)
    passEncoder.setVertexBuffer(0, boxVertexBuffer, 0, boxVertexBuffer.size)
    passEncoder.setBindGroup(0, boxUniformBindGroup)
    passEncoder.draw(36)

    passEncoder.end()
    const commandBuffer = commandEncoder.finish()
    device.queue.submit([commandBuffer])
  }

  // TODO: Make the flow of data clearer between update and render.
  async function animationLoop() {
    // Update world state
    const renderStartTime = performance.now()
    update()

    // Perform rendering work
    render()
    async function updatePerfStats() {
      await device.queue.onSubmittedWorkDone()
      const renderEndTime = performance.now()
      const renderTime = renderEndTime - renderStartTime

      // Update performance measurement data
      perfData.renderTimes.push(renderTime)
      if (perfData.renderTimes.length > 100) {
        perfData.renderTimes.shift()
      }

      // Update performance measurement display
      const avgRenderTime = perfData.renderTimes.reduce((a, b) => a + b, 0) / perfData.renderTimes.length
      const minRenderTime = Math.min(...perfData.renderTimes)
      const maxRenderTime = Math.max(...perfData.renderTimes)
      perfElements.renderTimeAvg.textContent = `Frame render time (last 100 avg): ${(avgRenderTime).toFixed(3)} ms`
      perfElements.renderTimeMax.textContent = `Frame render time (last 100 max): ${(maxRenderTime).toFixed(3)} ms`
      perfElements.renderTimeMin.textContent = `Frame render time (last 100 min): ${(minRenderTime).toFixed(3)} ms`
    }
    updatePerfStats()

    // Next frame
    requestAnimationFrame(animationLoop)
  }
  animationLoop();

}

main()

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

const shaders = /*wgsl*/ `
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
    let worldpos = rot2d(uniforms.time) * position.xy;
    let screenpos = worldpos * minres / reso;
    output.position = vec4f(screenpos, 0, 1);
    output.color = color;
    return output;
  }

  @fragment
  fn fragment_main(@location(0) color : vec3f) -> @location(0) vec4f {
    return vec4f(color, 1);
  }
`;

/** @param {HTMLCanvasElement} canvas */
function resizeGPUCanvas(canvas) {
  canvas.width = document.documentElement.clientWidth
  canvas.height = document.documentElement.clientHeight
}

async function main() {
  // Get DOM elements
  /** @type {HTMLCanvasElement} */
  const canvas = document.querySelector("#gpu-canvas")
  console.log(canvas)

  window.addEventListener("resize", () => resizeGPUCanvas(canvas))
  resizeGPUCanvas(canvas)

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

  // Create shader modules
  const shaderModule = device.createShaderModule({ code: shaders });
  const jumpFloodShaderModule = device.createShaderModule({
    code: /* wgsl */ `
      @compute
      fn compute_main() {
        
      }
    `,
  })

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
  const pipeline = device.createRenderPipeline({
    vertex: {
      module: shaderModule,
      entryPoint: "vertex_main",
      buffers: [vertexBufferLayouts],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fragment_main",
      targets: [
        { format: navigator.gpu.getPreferredCanvasFormat() },
      ],
    },
    layout: "auto",
    label: "render"
  });

  const jumpFloodPipeline = device.createComputePipeline({
    compute: {
      module: jumpFloodShaderModule,
      entryPoint: "computeMain"
    },
    layout: "auto",
    label: "jump-flood"
  })

  // Create vertex buffer
  const vertexBuffer = device.createBuffer({
    size: 1000,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  const vertexBufferData = new Float32Array([
    -0.43301, -0.25, 0, 1,
    1, 0, 0, 0,

    0.43301, -0.25, 0, 1,
    0, 1, 0, 0,

    0, 0.5, 0, 1,
    0, 0, 1, 0,
  ])
  const vertexBufferSize = vertexBufferData.byteLength;
  device.queue.writeBuffer(vertexBuffer, 0, vertexBufferData);

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
  })

  const uniformBindGroupLayout = pipeline.getBindGroupLayout(0)

  const uniformBindGroup = device.createBindGroup({
    entries: [{ binding: 0, resource: uniformBuffer }],
    layout: uniformBindGroupLayout,
  })

  function render() {
    // Prepare render target
    const canvasTexture = context.getCurrentTexture()
    const canvasTextureView = canvasTexture.createView()

    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
      canvas.width,
      canvas.height,
      time,
    ]))

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
      ]
    })
    passEncoder.setPipeline(pipeline)
    passEncoder.setVertexBuffer(0, vertexBuffer, 0, vertexBufferSize);
    passEncoder.setBindGroup(0, uniformBindGroup)
    passEncoder.draw(3);
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

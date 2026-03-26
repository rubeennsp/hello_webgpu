async function init() {
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

  const canvas = document.querySelector("#gpu-canvas");
  /** @type {GPUCanvasContext} */
  const canvasContext = canvas.getContext("webgpu")
  canvasContext.configure({
    device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: "premultiplied",
  });

  const context = {
    device: device,
    canvas: canvas,
    canvasContext: canvasContext,
  };
  return context;
}

const shaders = /*wgsl*/ `
  struct VertexOut {
    @builtin(position) position : vec4f,
    @location(0) color : vec3f,
  };

  @vertex
  fn vertex_main(@location(0) position : vec3f,
                 @location(1) color : vec3f) -> VertexOut {
    var output : VertexOut;
    output.position = vec4f(position, 1);
    output.color = color;
    return output;
  }

  @fragment
  fn fragment_main(@location(0) color : vec3f) -> @location(0) vec4f {
    return vec4f(color, 1);
  }
`;

async function main() {
  const context = await init();
  console.log(context);
  const device = context.device
  const canvasTexture = context.canvasContext.getCurrentTexture()

  // Create shader module
  const shaderModule = device.createShaderModule({ code: shaders });

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
  });

  // Create vertex buffer
  const vertexBuffer = device.createBuffer({
    size: 1000,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  const vertexBufferData = new Float32Array([
    -0.5, -0.5, 0, 1,
    1, 0, 0, 0,

    0.5, -0.5, 0, 1,
    0, 1, 0, 0,

    0, 0.5, 0, 1,
    0, 0, 1, 0,
  ])
  const vertexBufferSize = vertexBufferData.byteLength;
  device.queue.writeBuffer(vertexBuffer, 0, vertexBufferData);

  // Record commands and submit
  const commandEncoder = device.createCommandEncoder()
  const passEncoder = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        loadOp: "clear",
        storeOp: "store",
        view: canvasTexture.createView(),
        clearValue: [0, 0, 0, 1],
      }
    ]
  })
  passEncoder.setPipeline(pipeline)
  passEncoder.setVertexBuffer(0, vertexBuffer, 0, vertexBufferSize);
  passEncoder.draw(3);
  passEncoder.end()
  const commandBuffer = commandEncoder.finish()
  device.queue.submit([commandBuffer])

}

main()

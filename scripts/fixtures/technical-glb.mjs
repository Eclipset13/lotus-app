// Technical triangle only: never assign this fixture to a commercial flower.
export function technicalGlb(edit = () => {}, textured = false) {
  const json = {
    asset: { version: "2.0", generator: "Lotus isolated test fixture" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.7, 0.2, 0.3, 1], metallicFactor: 0, roughnessFactor: 0.7 }, doubleSided: true }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.4, 0, 0], max: [0.4, 3, 0] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
  };
  let binary = Buffer.alloc(36);
  [-0.4, 0, 0, 0.4, 0, 0, 0, 3, 0].forEach((n, i) => binary.writeFloatLE(n, i * 4));
  if (textured) {
    const uv = Buffer.alloc(24);
    [0, 0, 1, 0, 0.5, 1].forEach((n, i) => uv.writeFloatLE(n, i * 4));
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    binary = Buffer.concat([binary, uv, png, Buffer.alloc((4 - png.length % 4) % 4)]);
    json.buffers[0].byteLength = 60 + png.length;
    json.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: png.length });
    json.accessors.push({ bufferView: 1, componentType: 5126, count: 3, type: "VEC2" });
    json.meshes[0].primitives[0].attributes.TEXCOORD_0 = 1;
    json.images = [{ bufferView: 2, mimeType: "image/png" }]; json.textures = [{ source: 0 }];
    json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  }
  edit(json);
  let text = JSON.stringify(json);
  text += " ".repeat((4 - Buffer.byteLength(text) % 4) % 4);
  const encoded = Buffer.from(text);
  const bytes = Buffer.alloc(12 + 8 + encoded.length + 8 + binary.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(encoded.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); encoded.copy(bytes, 20);
  const bin = 20 + encoded.length;
  bytes.writeUInt32LE(binary.length, bin); bytes.writeUInt32LE(0x004e4942, bin + 4);
  binary.copy(bytes, bin + 8);
  return bytes;
}

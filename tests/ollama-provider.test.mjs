import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import { createBlockContract } from "../lib/job-parser/providers/block-contract.mjs";
import { createOllamaProvider } from "../lib/job-parser/providers/ollama.mjs";
import { createSemanticProvider } from "../lib/job-parser/providers/index.mjs";
import { ConfigSchema } from "../config/schema.mjs";
import {
  ollamaWireSchema,
  translateOllamaWireResponse,
} from "../lib/job-parser/providers/ollama-wire-contract.mjs";
import {
  createCheckpoint,
  executionIdentity,
  writeCheckpoint,
} from "../lib/job-parser/providers/checkpoint.mjs";

function blockResult(block) {
  const quote = block.text.replace(/^-\s*/u, "");
  if (quote.includes("Java ou Kotlin")) {
    return {
      status: "extracted",
      items: [],
      alternatives: [
        {
          type: "alternative",
          operator: "anyOf",
          values: ["Java", "Kotlin"],
          kind: "skill",
          classification: "required",
          evidence: { quote },
          ...(block.heading ? { sourceSection: block.heading } : {}),
        },
      ],
      metadata: {},
      reason: "",
    };
  }
  return {
    status: "extracted",
    items: [
      {
        type: "item",
        value: quote,
        kind: "requirement",
        classification: "required",
        evidence: { quote },
        ...(block.heading ? { sourceSection: block.heading } : {}),
      },
    ],
    alternatives: [],
    metadata: {},
    reason: "",
  };
}

function wireRecord(record, recordType, metadataKey = "none") {
  return {
    recordType,
    metadataKey,
    value: record.value ?? "",
    values: record.values ?? [],
    kind: record.kind ?? "none",
    classification: record.classification ?? "none",
    quote: record.evidence.quote,
    examples: (record.examples ?? []).map((example) => example.value),
  };
}

function wireBlock(id, result) {
  return {
    id,
    status: result.status,
    reason: result.reason,
    records: [
      ...result.items.map((record) => wireRecord(record, "item")),
      ...result.alternatives.map((record) => wireRecord(record, "alternative")),
      ...Object.entries(result.metadata).map(([key, record]) =>
        wireRecord(record, "metadata", key)
      ),
    ],
  };
}

test("Ollama preserves Portuguese alternatives across sequential batches", async () => {
  const document = preprocessJobDescription(
    [
      "Requisitos",
      "- Experiência com Java ou Kotlin",
      "- Inglês avançado",
      "- Experiência com APIs REST",
      "- Conhecimento de bancos de dados",
    ].join("\n")
  );
  const blocks = createBlockContract(document).blocks;
  const calls = [];
  const provider = createOllamaProvider({
    model: "test-model",
    batchSize: 2,
    maxAttempts: 1,
    maxCorrections: 0,
    logger: {},
    chat: async (request) => {
      calls.push(request);
      const call = calls.length - 1;
      const ids = blocks.slice(call * 2, call * 2 + 2).map((block) => block.id);
      return {
        message: {
          content: JSON.stringify({
            blocks: ids.map((id) =>
              wireBlock(
                id,
                blockResult(blocks.find((block) => block.id === id))
              )
            ),
          }),
        },
      };
    },
  });
  const extraction = await provider({ ...document, unresolved: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].messages[0].role, "system");
  assert.equal(calls[0].messages[1].role, "user");
  assert.equal(calls[0].format, ollamaWireSchema);
  assert.deepEqual(
    extraction.items.find((item) => item.type === "alternative").values,
    ["Java", "Kotlin"]
  );
  assert.equal(extraction.coverage.length, 4);
});

test("Ollama resumes a compatible checkpoint without resending accepted blocks", async () => {
  const document = preprocessJobDescription("Requirements\n- Node.js\n- PostgreSQL");
  const blocks = createBlockContract(document).blocks;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ollama-checkpoint-"));
  const checkpointPath = path.join(directory, "parse.checkpoint.json");
  const options = {
    timeoutMs: 120000,
    contextSize: 16384,
    maxPromptTokens: 10000,
    responseTokenReserve: 4000,
    batchSize: 1,
    maxCorrections: 0,
  };
  const identity = executionIdentity({
    inputText: document.normalizedText,
    provider: "ollama",
    model: "test-model",
    options,
  });
  await writeCheckpoint(
    checkpointPath,
    createCheckpoint(identity, {
      acceptedBlocks: { [blocks[0].id]: blockResult(blocks[0]) },
      confirmedMetadata: {},
      pendingIds: [blocks[1].id],
    })
  );
  const calls = [];
  const provider = createOllamaProvider({
    model: "test-model",
    batchSize: 1,
    maxAttempts: 1,
    maxCorrections: 0,
    checkpointPath,
    logger: {},
    chat: async (request) => {
      calls.push(request);
      return {
        message: {
          content: JSON.stringify({
            blocks: [wireBlock(blocks[1].id, blockResult(blocks[1]))],
          }),
        },
      };
    },
  });
  const extraction = await provider({ ...document, unresolved: [] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[1].content, /PostgreSQL/u);
  assert.doesNotMatch(calls[0].messages[1].content, /Node\.js/u);
  assert.equal(extraction.coverage.length, 2);
  await assert.rejects(fs.access(checkpointPath));
  await fs.rm(directory, { recursive: true, force: true });
});

test("Ollama ignores an incompatible checkpoint", async () => {
  const document = preprocessJobDescription("Requirements\n- Node.js");
  const [block] = createBlockContract(document).blocks;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ollama-checkpoint-"));
  const checkpointPath = path.join(directory, "parse.checkpoint.json");
  await writeCheckpoint(
    checkpointPath,
    createCheckpoint(
      executionIdentity({ inputText: "different job", provider: "ollama", model: "test-model" }),
      { acceptedBlocks: { [block.id]: blockResult(block) } }
    )
  );
  let calls = 0;
  const provider = createOllamaProvider({
    model: "test-model", maxAttempts: 1, maxCorrections: 0, checkpointPath, logger: {},
    chat: async () => {
      calls += 1;
      return { message: { content: JSON.stringify({ blocks: [wireBlock(block.id, blockResult(block))] }) } };
    },
  });
  await provider({ ...document, unresolved: [] });
  assert.equal(calls, 1);
  await fs.rm(directory, { recursive: true, force: true });
});

test("Ollama retains its checkpoint after a later batch fails", async () => {
  const document = preprocessJobDescription("Requirements\n- Node.js\n- PostgreSQL");
  const blocks = createBlockContract(document).blocks;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ollama-checkpoint-"));
  const checkpointPath = path.join(directory, "parse.checkpoint.json");
  let calls = 0;
  const provider = createOllamaProvider({
    model: "test-model", batchSize: 1, maxAttempts: 1, maxCorrections: 0, checkpointPath, logger: {},
    chat: async () => {
      calls += 1;
      if (calls === 1)
        return { message: { content: JSON.stringify({ blocks: [wireBlock(blocks[0].id, blockResult(blocks[0]))] }) } };
      throw Object.assign(new Error("service unavailable"), { code: "ECONNREFUSED" });
    },
  });
  await assert.rejects(provider({ ...document, unresolved: [] }));
  const checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
  assert.ok(checkpoint.acceptedBlocks[blocks[0].id]);
  await fs.rm(directory, { recursive: true, force: true });
});

test("Ollama preserves a signaled bullet that the model silently excludes", async () => {
  const document = preprocessJobDescription(
    "Required Qualifications\n- Experience building distributed systems"
  );
  const [block] = createBlockContract(document).blocks;
  const warnings = [];
  const provider = createOllamaProvider({
    maxAttempts: 1,
    maxCorrections: 0,
    logger: { warn: (message) => warnings.push(message) },
    chat: async () => ({
      message: {
        content: JSON.stringify({
          blocks: [
            {
              id: block.id,
              status: "excluded",
              reason: "No explicit job details found",
              records: [],
            },
          ],
        }),
      },
    }),
  });

  const extraction = await provider({ ...document, unresolved: [] });

  assert.deepEqual(extraction.items, [
    {
      type: "item",
      value: "Experience building distributed systems",
      kind: "requirement",
      classification: "required",
      evidence: { quote: "- Experience building distributed systems" },
      sourceSection: "Required Qualifications",
      sourceUnitIds: [block.id],
    },
  ]);
  assert.match(warnings[0], /signaled_bullet_preserved/u);
});

test("Ollama wire translation rejects missing and duplicate block IDs", () => {
  const blocks = createBlockContract(
    preprocessJobDescription("Requirements\n- Node.js\n- PostgreSQL")
  ).blocks;
  const excluded = (id) => ({
    id,
    status: "excluded",
    reason: "No relevant record.",
    records: [],
  });
  assert.throws(
    () =>
      translateOllamaWireResponse({ blocks: [excluded(blocks[0].id)] }, blocks),
    /missing block IDs/u
  );
  assert.throws(
    () =>
      translateOllamaWireResponse(
        {
          blocks: blocks
            .map((block) => excluded(block.id))
            .concat(excluded(blocks[0].id)),
        },
        blocks
      ),
    /duplicate block ID/u
  );
});

test("Ollama wire translation removes whitespace-only placeholders from excluded blocks", () => {
  const blocks = createBlockContract(
    preprocessJobDescription("Company marketing only")
  ).blocks;
  const translated = translateOllamaWireResponse(
    {
      blocks: [
        {
          id: blocks[0].id,
          status: "excluded",
          reason: "Company context only.",
          records: [
            {
              recordType: "item",
              metadataKey: "none",
              value: " \n\t ",
              values: [],
              kind: "none",
              classification: "not-applicable",
              quote: "Company marketing only",
              examples: [],
            },
          ],
        },
      ],
    },
    blocks
  );
  assert.deepEqual(translated.blocks[blocks[0].id].items, []);
});

test("Ollama passes confirmed metadata to later batches", async () => {
  const document = preprocessJobDescription(
    "About\n- Example\nRequirements\n- Modern cloud experience"
  );
  const blocks = createBlockContract(document).blocks;
  const prompts = [];
  const provider = createOllamaProvider({
    batchSize: 1,
    maxAttempts: 1,
    maxCorrections: 0,
    logger: {},
    chat: async (request) => {
      prompts.push(request.messages[1].content);
      const id = blocks[prompts.length - 1].id;
      const block = blocks.find((candidate) => candidate.id === id);
      const result =
        block.text === "About"
          ? {
              status: "excluded",
              items: [],
              alternatives: [],
              metadata: {},
              reason: "Standalone context heading.",
            }
          : block.text.includes("Example")
            ? {
                status: "extracted",
                items: [],
                alternatives: [],
                metadata: {
                  company: { value: "Example", evidence: { quote: "Example" } },
                },
                reason: "",
              }
            : blockResult(block);
      return {
        message: {
          content: JSON.stringify({ blocks: [wireBlock(id, result)] }),
        },
      };
    },
  });
  const extraction = await provider({ ...document, unresolved: [] });
  assert.equal(extraction.metadata.company.value, "Example");
  assert.match(
    prompts[2],
    /Already confirmed metadata: \{"company":"Example"\}/u
  );
});

test("Ollama preserves geographic location and remote-work metadata", async () => {
  const document = preprocessJobDescription(
    "Location\n- São Paulo - SP\n- Trabalho 100% remoto"
  );
  const blocks = createBlockContract(document).blocks;
  const response = {
    blocks: blocks.map((block) => {
      if (block.text === "Location") {
        return wireBlock(block.id, {
          status: "excluded",
          items: [],
          alternatives: [],
          metadata: {},
          reason: "Standalone context heading.",
        });
      }
      const location = block.text.includes("São Paulo");
      const key = location ? "location" : "workArrangement";
      const value = location ? "São Paulo - SP" : "Trabalho 100% remoto";
      return wireBlock(block.id, {
        status: "extracted",
        items: [],
        alternatives: [],
        metadata: { [key]: { value, evidence: { quote: value } } },
        reason: "",
      });
    }),
  };
  const provider = createOllamaProvider({
    batchSize: 3,
    maxAttempts: 1,
    maxCorrections: 0,
    logger: {},
    chat: async () => ({ message: { content: JSON.stringify(response) } }),
  });
  const extraction = await provider({ ...document, unresolved: [] });
  assert.equal(extraction.metadata.location.value, "São Paulo - SP");
  assert.equal(
    extraction.metadata.workArrangement.value,
    "Trabalho 100% remoto"
  );
});

test("Ollama correction exhaustion fails without silently accepting blocks", async () => {
  const document = preprocessJobDescription(
    "Requirements\n- Modern cloud experience"
  );
  let calls = 0;
  const provider = createOllamaProvider({
    maxAttempts: 1,
    maxCorrections: 2,
    logger: {},
    chat: async () => {
      calls += 1;
      return { message: { content: JSON.stringify({ blocks: {} }) } };
    },
  });
  await assert.rejects(
    () => provider({ ...document, unresolved: [] }),
    /OLLAMA_SCHEMA_ERROR/
  );
  assert.equal(calls, 3);
});

test("Ollama splits a multi-block batch after schema corrections are exhausted", async () => {
  const document = preprocessJobDescription(
    "Requirements\n- Requirement alpha\n- Requirement beta"
  );
  let calls = 0;
  const requested = [];
  const provider = createOllamaProvider({
    batchSize: 2,
    maxAttempts: 1,
    maxCorrections: 1,
    logger: {},
    chat: async (request) => {
      calls += 1;
      const marker = "SOURCE BLOCKS: ";
      const prompt = request.messages[1].content;
      const requestedBlocks = JSON.parse(
        prompt.slice(prompt.indexOf(marker) + marker.length)
      );
      requested.push(requestedBlocks.map((block) => block.id));
      if (requestedBlocks.length > 1)
        return { message: { content: JSON.stringify({ blocks: [] }) } };
      return {
        message: {
          content: JSON.stringify({
            blocks: [
              wireBlock(requestedBlocks[0].id, blockResult(requestedBlocks[0])),
            ],
          }),
        },
      };
    },
  });
  const extraction = await provider({ ...document, unresolved: [] });
  assert.deepEqual(
    requested.map((ids) => ids.length),
    [2, 2, 1, 1]
  );
  assert.equal(calls, 4);
  assert.equal(extraction.items.length, 2);
});

test("Ollama corrects only invalid blocks and never requests accepted blocks again", async () => {
  const document = preprocessJobDescription(
    [
      "Requirements",
      "- Requirement alpha",
      "- Requirement beta",
      "- Requirement gamma",
    ].join("\n")
  );
  const requested = [];
  const provider = createOllamaProvider({
    batchSize: 3,
    maxAttempts: 1,
    maxCorrections: 1,
    logger: {},
    chat: async (request) => {
      const marker = "SOURCE BLOCKS: ";
      const prompt = request.messages[1].content;
      const blocks = JSON.parse(
        prompt.slice(prompt.indexOf(marker) + marker.length)
      );
      requested.push(blocks.map((block) => block.id));
      const results = blocks.map((block) => blockResult(block));
      if (requested.length === 1) {
        results[1].items[0].value = "Invented requirement";
      }
      return {
        message: {
          content: JSON.stringify({
            blocks: blocks.map((block, index) =>
              wireBlock(block.id, results[index])
            ),
          }),
        },
      };
    },
  });

  const extraction = await provider({ ...document, unresolved: [] });

  assert.deepEqual(
    requested.map((ids) => ids.length),
    [3, 1]
  );
  assert.equal(requested[1][0], requested[0][1]);
  assert.equal(extraction.items.length, 3);
  assert.deepEqual(
    extraction.items.map((item) => item.value),
    ["Requirement alpha", "Requirement beta", "Requirement gamma"]
  );
});

test("Ollama localizes wire translation failures to the malformed block", async () => {
  const document = preprocessJobDescription(
    [
      "Requirements",
      "- Requirement alpha",
      "- Requirement beta",
      "- Requirement gamma",
    ].join("\n")
  );
  const requested = [];
  const provider = createOllamaProvider({
    batchSize: 3,
    maxAttempts: 1,
    maxCorrections: 1,
    logger: {},
    chat: async (request) => {
      const marker = "SOURCE BLOCKS: ";
      const prompt = request.messages[1].content;
      const blocks = JSON.parse(
        prompt.slice(prompt.indexOf(marker) + marker.length)
      );
      requested.push(blocks.map((block) => block.id));
      const results = blocks.map((block) =>
        wireBlock(block.id, blockResult(block))
      );
      if (requested.length === 1) delete results[1].records[0].examples;
      return {
        message: { content: JSON.stringify({ blocks: results }) },
      };
    },
  });

  const extraction = await provider({ ...document, unresolved: [] });

  assert.deepEqual(
    requested.map((ids) => ids.length),
    [3, 1]
  );
  assert.equal(requested[1][0], requested[0][1]);
  assert.equal(extraction.items.length, 3);
});

test("Ollama splits only invalid blocks after targeted correction is exhausted", async () => {
  const document = preprocessJobDescription(
    [
      "Requirements",
      "- Requirement alpha",
      "- Requirement beta",
      "- Requirement gamma",
    ].join("\n")
  );
  const requested = [];
  const provider = createOllamaProvider({
    batchSize: 3,
    maxAttempts: 1,
    maxCorrections: 1,
    logger: {},
    chat: async (request) => {
      const marker = "SOURCE BLOCKS: ";
      const prompt = request.messages[1].content;
      const blocks = JSON.parse(
        prompt.slice(prompt.indexOf(marker) + marker.length)
      );
      requested.push(blocks.map((block) => block.id));
      const results = blocks.map((block) => blockResult(block));
      if (blocks.length > 1) {
        const start = requested.length === 1 ? 1 : 0;
        for (let index = start; index < results.length; index += 1)
          results[index].items[0].value = `Invented ${index}`;
      }
      return {
        message: {
          content: JSON.stringify({
            blocks: blocks.map((block, index) =>
              wireBlock(block.id, results[index])
            ),
          }),
        },
      };
    },
  });

  const extraction = await provider({ ...document, unresolved: [] });

  assert.deepEqual(
    requested.map((ids) => ids.length),
    [3, 2, 1, 1]
  );
  assert.equal(
    requested.slice(1).flat().includes(requested[0][0]),
    false,
    "the accepted block must not be corrected or split"
  );
  assert.equal(extraction.items.length, 3);
});

test("Ollama treats an undefined response as correctable and retries", async () => {
  const document = preprocessJobDescription(
    "Requirements\n- Modern cloud experience"
  );
  const block = createBlockContract(document).blocks.find((candidate) =>
    candidate.text.includes("Modern cloud experience")
  );
  let calls = 0;
  const provider = createOllamaProvider({
    maxAttempts: 1,
    maxCorrections: 1,
    logger: {},
    chat: async () => {
      calls += 1;
      if (calls === 1) return undefined;
      return {
        message: {
          content: JSON.stringify({
            blocks: [wireBlock(block.id, blockResult(block))],
          }),
        },
      };
    },
  });

  const extraction = await provider({ ...document, unresolved: [] });

  assert.equal(calls, 2);
  assert.equal(extraction.items[0].value, "Modern cloud experience");
});

test("Ollama timeout aborts the active request", async () => {
  const document = preprocessJobDescription(
    "Requirements\n- Modern cloud experience"
  );
  let observedSignal;
  const provider = createOllamaProvider({
    timeoutMs: 5,
    maxAttempts: 1,
    logger: {},
    fetchImpl: (_url, options) => {
      observedSignal = options.signal;
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        );
      });
    },
  });
  await assert.rejects(
    () => provider({ ...document, unresolved: [] }),
    /OLLAMA_TIMEOUT/
  );
  assert.equal(observedSignal.aborted, true);
});

test("Ollama splits only the failed context-sized batch and preserves all blocks", async () => {
  const document = preprocessJobDescription(
    [
      "Requirements",
      "- Modern cloud experience",
      "- Distributed systems experience",
      "- API design experience",
      "- Database design experience",
    ].join("\n")
  );
  let calls = 0;
  const requested = [];
  const provider = createOllamaProvider({
    batchSize: 4,
    maxAttempts: 1,
    maxCorrections: 0,
    logger: {},
    chat: async (request) => {
      calls += 1;
      const marker = "SOURCE BLOCKS: ";
      const prompt = request.messages[1].content;
      const requestedBlocks = JSON.parse(
        prompt.slice(prompt.indexOf(marker) + marker.length)
      );
      requested.push(requestedBlocks.map((block) => block.id));
      if (calls === 1) {
        const error = new Error("prompt exceeds context length");
        error.status_code = 413;
        throw error;
      }
      return {
        message: {
          content: JSON.stringify({
            blocks: requestedBlocks.map((block) =>
              wireBlock(block.id, blockResult(block))
            ),
          }),
        },
      };
    },
  });
  const extraction = await provider({ ...document, unresolved: [] });
  assert.deepEqual(
    requested.map((ids) => ids.length),
    [4, 2, 2]
  );
  assert.deepEqual(requested.slice(1).flat(), requested[0]);
  assert.equal(extraction.items.length, 4);
  assert.equal(extraction.coverage.length, 4);
});

test("Ollama timeout splitting does not repeat an already validated batch", async () => {
  const document = preprocessJobDescription(
    [
      "Requirements",
      "- Requirement alpha",
      "- Requirement beta",
      "- Requirement gamma",
      "- Requirement delta",
    ].join("\n")
  );
  const requested = [];
  let calls = 0;
  const provider = createOllamaProvider({
    batchSize: 2,
    timeoutMs: 5,
    maxAttempts: 1,
    maxCorrections: 0,
    logger: {},
    chat: async (request, { signal }) => {
      calls += 1;
      const marker = "SOURCE BLOCKS: ";
      const prompt = request.messages[1].content;
      const requestedBlocks = JSON.parse(
        prompt.slice(prompt.indexOf(marker) + marker.length)
      );
      requested.push(requestedBlocks.map((block) => block.id));
      if (calls === 2) {
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")))
        );
      }
      return {
        message: {
          content: JSON.stringify({
            blocks: requestedBlocks.map((block) =>
              wireBlock(block.id, blockResult(block))
            ),
          }),
        },
      };
    },
  });
  const extraction = await provider({ ...document, unresolved: [] });
  assert.deepEqual(
    requested.map((ids) => ids.length),
    [2, 2, 1, 1]
  );
  assert.equal(
    requested.slice(1).flat().includes(requested[0][0]),
    false,
    "the validated first batch must not be sent again"
  );
  assert.equal(extraction.items.length, 4);
});

for (const [status, code] of [
  [401, "SEMANTIC_PROVIDER_AUTH_ERROR"],
  [429, "SEMANTIC_PROVIDER_RATE_LIMIT"],
]) {
  test(`Ollama HTTP ${status} maps to ${code}`, async () => {
    const document = preprocessJobDescription(
      "Requirements\n- Modern cloud experience"
    );
    const config = ConfigSchema.parse({
      jobParser: { semanticProvider: "ollama" },
    });
    const selected = createSemanticProvider({
      name: "ollama",
      config,
      env: {},
      dependencies: {
        chat: async () => {
          const error = new Error(`HTTP ${status}`);
          error.status_code = status;
          throw error;
        },
      },
    });
    await assert.rejects(
      () => selected.provider({ ...document, unresolved: [] }),
      (error) => error.code === code
    );
  });
}

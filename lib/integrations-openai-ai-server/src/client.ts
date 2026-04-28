import OpenAI from "openai";

function createOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY must be set before making OpenAI API calls.",
    );
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });
}

let client: OpenAI | undefined;

function getOpenAI(): OpenAI {
  client ??= createOpenAI();
  return client;
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    return Reflect.get(getOpenAI(), prop, receiver);
  },
});

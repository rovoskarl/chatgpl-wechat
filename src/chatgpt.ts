import { Config } from "./config.js";
import { Message } from "wechaty";
import { ContactInterface, RoomInterface } from "wechaty/impls";
import { Configuration, OpenAIApi } from "openai";

const chatgptErrorMessage = "🤖️：AI机器人摆烂了，请稍后再试～";

// please refer to the OpenAI API doc: https://beta.openai.com/docs/api-reference/introduction
const ChatGPTModelConfig = {
  // this model field is required
  model: "code-davinci-002",
  prompt: "\"\"\"\nUtil exposes the following:\nutil.openai() -> authenticates & returns the openai module, which has the following functions:\nopenai.Completion.create(\n    prompt=\"<my prompt>\", # The prompt to start completing from\n    max_tokens=123, # The max number of tokens to generate\n    temperature=1.0 # A measure of randomness\n    echo=True, # Whether to return the prompt in addition to the generated completion\n)\n\"\"\"\nimport util\n\"\"\"\nCreate an OpenAI completion starting from the prompt \"Once upon an AI\", no more than 5 tokens. Does not include the prompt.\n\"\"\"\n",
  temperature: 0,
  max_tokens: 64,
  top_p: 1.0,
  frequency_penalty: 0.0,
  presence_penalty: 0.0,
  stop: ["\"\"\""],
  // add your ChatGPT model parameters below
  // temperature: 0.9,
  // max_tokens: 2000,
};

// message size for a single reply by the bot
const SINGLE_MESSAGE_MAX_SIZE = 500;

enum MessageType {
  Unknown = 0,
  Attachment = 1, // Attach(6),
  Audio = 2, // Audio(1), Voice(34)
  Contact = 3, // ShareCard(42)
  ChatHistory = 4, // ChatHistory(19)
  Emoticon = 5, // Sticker: Emoticon(15), Emoticon(47)
  Image = 6, // Img(2), Image(3)
  Text = 7, // Text(1)
  Location = 8, // Location(48)
  MiniProgram = 9, // MiniProgram(33)
  GroupNote = 10, // GroupNote(53)
  Transfer = 11, // Transfers(2000)
  RedEnvelope = 12, // RedEnvelopes(2001)
  Recalled = 13, // Recalled(10002)
  Url = 14, // Url(5)
  Video = 15, // Video(4), Video(43)
  Post = 16, // Moment, Channel, Tweet, etc
}

export class ChatGPTBot {
  botName: string = "";
  chatgptTriggerKeyword = Config.chatgptTriggerKeyword;
  OpenAIConfig: any;
  OpenAI: any;
  applyContext(text: string): string {
    return `You are an artificial intelligence bot from a company called "OpenAI". Your primary tasks are chatting with users and answering their questions. If the user says "${text}", you will say:`;
  }

  setBotName(botName: string) {
    this.botName = botName;
  }

  // get trigger keyword in group chat: (@Name <keyword>)
  get chatGroupTriggerKeyword(): string {
    return `@${this.botName} ${this.chatgptTriggerKeyword || ""}`;
  }

  // configure API with model API keys and run a initial test
  async startGPTBot() {
    // OpenAI Account configuration
    this.OpenAIConfig = new Configuration({
      organization: Config.openaiOrganizationID,
      apiKey: Config.openaiApiKey,
    });
    // OpenAI API instance
    this.OpenAI = new OpenAIApi(this.OpenAIConfig);
    // Run an initial test to confirm API works fine
    await this.onChatGPT("Say Hello World");
    console.log(`🤖️ ChatGPT Bot Start Success, ready to handle message!`);
  }

  cleanMessage(rawText: string, isPrivateChat: boolean = false): string {
    let text = rawText;
    const item = rawText.split("- - - - - - - - - - - - - - -");
    if (item.length > 1) {
      text = item[item.length - 1];
    }
    text = text.replace(
      isPrivateChat ? this.chatgptTriggerKeyword : this.chatGroupTriggerKeyword,
      ""
    );
    return text;
  }

  triggerGPTMessage(text: string, isPrivateChat: boolean = false): boolean {
    const chatgptTriggerKeyword = this.chatgptTriggerKeyword;
    let triggered = false;
    if (isPrivateChat) {
      triggered = chatgptTriggerKeyword
        ? text.startsWith(chatgptTriggerKeyword)
        : true;
    } else {
      triggered = text.startsWith(this.chatGroupTriggerKeyword);
    }
    if (triggered) {
      console.log(`🎯 ChatGPT Triggered: ${text}`);
    }
    return triggered;
  }

  isNonsense(
    talker: ContactInterface,
    messageType: MessageType,
    text: string
  ): boolean {
    return (
      talker.self() ||
      messageType > MessageType.GroupNote ||
      talker.name() == "微信团队" ||
      text.includes("收到一条视频/语音聊天消息，请在手机上查看") ||
      text.includes("收到红包，请在手机上查看") ||
      text.includes("/cgi-bin/mmwebwx-bin/webwxgetpubliclinkimg")
    );
  }

  async onChatGPT(text: string): Promise<string> {
    const inputMessage = this.applyContext(text);
    try {
      const response = await this.OpenAI.createCompletion({
        ...ChatGPTModelConfig,
        prompt: inputMessage,
      });
      console.log('---------', JSON.stringify(response?.data));
      const chatgptReplyMessage = response?.data?.choices[0]?.text?.trim();
      console.log("🤖️ ChatGPT says: ", chatgptReplyMessage);
      return chatgptReplyMessage;
    } catch (e: any) {
      const errorResponse = e?.response;
      const errorCode = errorResponse?.status;
      const errorStatus = errorResponse?.statusText;
      const errorMessage = errorResponse?.data?.error?.message;
      console.log(`❌ Code ${errorCode}: ${errorStatus}`);
      console.log(`❌ ${errorMessage}`);
      return chatgptErrorMessage;
    }
  }

  // reply with the segmented messages from a single-long message
  async reply(
    talker: RoomInterface | ContactInterface,
    mesasge: string
  ): Promise<void> {
    const messages: Array<string> = [];
    let message = mesasge;
    while (message.length > SINGLE_MESSAGE_MAX_SIZE) {
      messages.push(message.slice(0, SINGLE_MESSAGE_MAX_SIZE));
      message = message.slice(SINGLE_MESSAGE_MAX_SIZE);
    }
    messages.push(message);
    for (const msg of messages) {
      await talker.say(msg);
    }
  }

  // reply to private message
  async onPrivateMessage(talker: ContactInterface, text: string) {
    // get reply from ChatGPT
    const chatgptReplyMessage = await this.onChatGPT(text);
    // send the ChatGPT reply to chat
    await this.reply(talker, chatgptReplyMessage);
  }

  // reply to group message
  async onGroupMessage(room: RoomInterface, text: string) {
    // get reply from ChatGPT
    const chatgptReplyMessage = await this.onChatGPT(text);
    // the reply consist of: original text and bot reply
    const result = `${text}\n ---------- \n ${chatgptReplyMessage}`;
    await this.reply(room, result);
  }

  // receive a message (main entry)
  async onMessage(message: Message) {
    const talker = message.talker();
    const rawText = message.text();
    const room = message.room();
    const messageType = message.type();
    const isPrivateChat = !room;
    // do nothing if the message:
    //    1. is irrelevant (e.g. voice, video, location...), or
    //    2. doesn't trigger bot (e.g. wrong trigger-word)
    if (
      this.isNonsense(talker, messageType, rawText) ||
      !this.triggerGPTMessage(rawText, isPrivateChat)
    ) {
      return;
    }
    // clean the message for ChatGPT input
    const text = this.cleanMessage(rawText, isPrivateChat);
    // reply to private or group chat
    if (isPrivateChat) {
      return await this.onPrivateMessage(talker, text);
    } else {
      return await this.onGroupMessage(room, text);
    }
  }
}

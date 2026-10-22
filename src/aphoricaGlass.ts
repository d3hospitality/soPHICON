import { pushThoughtGlobe } from "./image-utils";
import { thoughtGlobeModule } from "./thoughtGlobe";
import {
  EvenAppBridge,
  EvenHubEvent,
  RebuildPageContainer,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  ImageContainerProperty,
} from "@evenrealities/even_hub_sdk";
import { authHeaders, onAccountChange } from "./enkiAccount";
type Action = [string, () => Promise<void>];
const API = "https://sophicon-api.vercel.app/api/social";
export function textPages(text: string, width = 42, rows = 5): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      let chars = Array.from(word);
      if (Array.from(line).length + chars.length + 1 > width && line) {
        lines.push(line);
        line = "";
      }
      while (chars.length > width) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(chars.splice(0, width).join(""));
      }
      if (chars.length) line += (line ? " " : "") + chars.join("");
    }
    lines.push(line);
  }
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += rows)
    pages.push(lines.slice(i, i + rows).join("\n"));
  return pages.length ? pages : [" "];
}
export class AphoricaGlass {
  private actions: Action[] = [];
  private busy = false;
  private channels: any[] = [];
  private channel = "";
  private draft: any = null;
  private post: any = null;
  private pageIndex = 0;
  private recording: "title" | "body" | "reply" | null = null;
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = true;
  private unsubscribeAccount: (() => void) | undefined;
  private returnTo: () => Promise<void>;
  private revision = 0;
  constructor(
    private bridge: EvenAppBridge,
    private exit: () => Promise<void>,
  ) {
    this.returnTo = () => this.menu();
    this.unsubscribeAccount = onAccountChange(() => {
      this.revision++;
      this.draft = null;
      this.chunks = [];
      if (this.active) void this.stopRecording(false).then(() => this.menu());
    });
  }
  private async api(body?: any, query = "") {
    const r = await fetch(API + query, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Please try again.");
    return d;
  }
  private async page(title: string, body: string, rows: Action[], part = 0) {
    const pages = textPages(body);
    const index = Math.max(0, Math.min(part, pages.length - 1));
    this.actions =
      pages.length > 1
        ? [
            [
              `Read ${index + 1}/${pages.length} >`,
              () => this.page(title, body, rows, (index + 1) % pages.length),
            ],
            ...rows,
          ]
        : rows;
    const page = new RebuildPageContainer({
      containerTotalNum: 3,
      textObject: [
        new TextContainerProperty({
          containerID: 81,
          containerName: "aph-title",
          xPosition: 20,
          yPosition: 8,
          width: 536,
          height: 30,
          content: title.slice(0, 45),
          isEventCapture: 0,
        }),
        new TextContainerProperty({
          containerID: 82,
          containerName: "aph-body",
          xPosition: 20,
          yPosition: 43,
          width: 536,
          height: 142,
          content: pages[index],
          isEventCapture: 0,
        }),
      ],
      listObject: [
        new ListContainerProperty({
          containerID: 83,
          containerName: "aph-actions",
          xPosition: 20,
          yPosition: 190,
          width: 536,
          height: 94,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: this.actions.length,
            itemWidth: 520,
            isItemSelectBorderEn: 1,
            itemName: this.actions.map((r) => r[0].slice(0, 60)),
          }),
        }),
      ],
    });
    if (!(await this.bridge.rebuildPageContainer(page)))
      throw Error("Display unavailable. Try again.");
  }
  async open() {
    this.active = true;
    try {
      this.channels = (await this.api(undefined, "?view=channels")).channels;
      await this.menu();
    } catch (e) {
      await this.note((e as Error).message);
    }
  }
  async close() {
    this.active = false;
    this.revision++;
    this.unsubscribeAccount?.();
    await this.stopRecording(false);
    await this.exit();
  }
  private async menu() {
    this.returnTo = () => this.menu();
    await this.page(
      "APHORICA",
      "Speak a thought. Let it find its people.\nEverything is free.",
      [
        ["Latest thoughts", () => this.feed()],
        ["Following", () => this.feed("", true)],
        ["Discover topics", () => this.topics()],
        ["New thought", () => this.newThought()],
        ["My private drafts", () => this.drafts()],
        ["Thought globe", () => this.globe()],
        ["Back", () => this.close()],
      ],
    );
  }
  private async topics(offset = 0) {
    this.channels = (await this.api(undefined, "?view=channels")).channels;
    const ordered = [...this.channels].sort(
      (a, b) => b.score + b.followers - (a.score + a.followers),
    );
    await this.page(
      "DISCOVER TOPICS",
      "Followers and recommendations are separate.\nLists stay still until you refresh.",
      [
        ...ordered
          .slice(offset, offset + 7)
          .map(
            (c) =>
              [`${c.name} (${c.followers})`, () => this.topic(c)] as Action,
          ),
        ...(ordered.length > offset + 7
          ? [["More topics", () => this.topics(offset + 7)] as Action]
          : []),
        ["Back", () => this.menu()],
      ],
    );
  }
  private async topic(c: any) {
    this.channel = c.id;
    await this.page(
      c.name,
      `${c.description}\n${c.followers} followers | ${c.score} topic score`,
      [
        ["Read thoughts", () => this.feed(c.id)],
        [
          c.following ? "Unfollow" : "Follow",
          async () => {
            await this.api({
              action: "follow",
              channel_id: c.id,
              following: !c.following,
            });
            c.following = !c.following;
            c.followers += c.following ? 1 : -1;
            await this.topic(c);
          },
        ],
        [
          "Recommend topic",
          async () => {
            await this.api({
              action: "channel_vote",
              channel_id: c.id,
              vote: c.vote === 1 ? 0 : 1,
            });
            await this.topics();
          },
        ],
        ["New thought here", () => this.newThought(c.id)],
        ["Back", () => this.topics()],
      ],
    );
  }
  private async feed(channel = "", following = false, before = "") {
    this.channel = channel;
    const q = new URLSearchParams({
      view: "feed",
      limit: "15",
      ...(channel ? { channel } : {}),
      ...(following ? { following: "1" } : {}),
      ...(before ? { before } : {}),
    });
    const data = await this.api(undefined, "?" + q);
    const rows: Action[] = data.posts
      .slice(0, 15)
      .map((p: any) => [
        `${p.upvotes - p.downvotes} | ${p.title}`,
        () => this.readPost(p.id),
      ]); // page size requested below keeps all posts reachable
    await this.page(
      "THOUGHTS",
      data.posts.length
        ? "Choose a thought to read and respond."
        : "No thoughts here yet. Be the first.",
      [
        ...rows,
        ...(data.next
          ? [
              [
                "More thoughts",
                () => this.feed(channel, following, data.next),
              ] as Action,
            ]
          : []),
        ["New thought", () => this.newThought(channel)],
        ["Back", () => this.menu()],
      ],
    );
  }
  private async readPost(id: string) {
    const d = await this.api(undefined, `?view=post&id=${id}`);
    this.post = d.post;
    this.returnTo = () => this.readPost(id);
    await this.page(
      this.post.title,
      `${this.post.title}\n@${this.post.username}\n${this.post.body}`,
      [
        [
          `Vote / discuss (${this.post.upvotes - this.post.downvotes})`,
          () => this.postActions(d),
        ],
        ["Back to thoughts", () => this.feed(this.channel)],
      ],
    );
  }
  private async postActions(d: any) {
    const p = d.post;
    await this.page("JOIN THE CONVERSATION", p.title, [
      [
        p.vote === 1 ? "Clear upvote" : "Upvote",
        async () => {
          await this.api({
            action: "vote",
            post_id: p.id,
            vote: p.vote === 1 ? 0 : 1,
          });
          await this.readPost(p.id);
        },
      ],
      [
        p.vote === -1 ? "Clear downvote" : "Downvote",
        async () => {
          await this.api({
            action: "vote",
            post_id: p.id,
            vote: p.vote === -1 ? 0 : -1,
          });
          await this.readPost(p.id);
        },
      ],
      ["Read replies", () => this.replies(d)],
      ["Dictate reply", () => this.record("reply")],
      ["Discuss with Enki", () => this.enki(p.id)],
      [
        "Report post",
        async () => {
          await this.api({
            action: "report",
            post_id: p.id,
            reason: "Member requested review from Even glasses",
          });
          await this.note("Report recorded. Thank you.");
        },
      ],
      ["Back", () => this.readPost(p.id)],
    ]);
  }
  private async replies(d: any, index = 0) {
    const c = d.comments[index];
    await this.page(
      "REPLIES",
      c ? `@${c.username}\n${c.body}` : "No replies yet.",
      [
        ...(d.comments.length > index + 1
          ? [["Next reply", () => this.replies(d, index + 1)] as Action]
          : []),
        ["Dictate reply", () => this.record("reply")],
        ["Back", () => this.readPost(d.post.id)],
      ],
    );
  }
  private async enki(id: string) {
    await this.page(
      "ENKI / AI",
      "Finding a perspective in the philosophy library…",
      [["Back", () => this.readPost(id)]],
    );
    const d = await this.api({ action: "enki", post_id: id });
    await this.page("ENKI / AI · PRIVATE", d.text, [
      [
        "Sources",
        () =>
          this.page(
            "PHILOSOPHY SOURCES",
            d.sources
              .map((s: any) => `[${s.id}] ${s.author}: ${s.source}\n${s.text}`)
              .join("\n"),
            [["Back to thought", () => this.readPost(id)]],
          ),
      ],
      ["Back to thought", () => this.readPost(id)],
    ]);
  }
  private async newThought(channel = "") {
    const me = await this.api(undefined, "?view=me");
    if (!me.user?.complete)
      return this.note(
        "Finish your free profile at enkiridion.com/aphorica. Pair once in the Even phone app, then publish from here.",
      );
    this.draft = {
      id: crypto.randomUUID(),
      title: "",
      body: "",
      channel_id: channel || this.channels[0]?.id,
      region: null,
      revision: 0,
    };
    await this.chooseChannel();
  }
  private async chooseChannel(offset = 0) {
    await this.page(
      "CHOOSE A TOPIC",
      "Your draft stays private until you confirm publication.",
      [
        ...this.channels.slice(offset, offset + 8).map(
          (c) =>
            [
              c.name,
              async () => {
                this.draft.channel_id = c.id;
                await this.compose();
              },
            ] as Action,
        ),
        ...(this.channels.length > offset + 8
          ? [["More", () => this.chooseChannel(offset + 8)] as Action]
          : []),
        ["Back", () => this.menu()],
      ],
    );
  }
  private async compose() {
    this.returnTo = () => this.compose();
    await this.page(
      "PRIVATE THOUGHT",
      `${this.draft.title || "No title yet"}\n${this.draft.body || "Dictate your thought, then review every word."}`,
      [
        [
          this.draft.title ? "Re-record title" : "Record title",
          () => this.record("title"),
        ],
        [
          this.draft.body ? "Re-record thought" : "Record thought",
          () => this.record("body"),
        ],
        ["Review for publication", () => this.review()],
        ["Change topic", () => this.chooseChannel()],
        [
          "Save / edit on web",
          async () => {
            await this.save();
            await this.note(
              `Private draft saved.\nOpen enkiridion.com/aphorica → My drafts on your phone.\n${this.draft.title || "New thought"}`,
            );
          },
        ],
        ["Back", () => this.menu()],
      ],
    );
  }
  private async save() {
    const expected = this.revision;
    const result = await this.api({ action: "draft", ...this.draft });
    if (expected !== this.revision)
      throw Error("Account changed. Reopen your own drafts.");
    this.draft = result;
  }
  private async drafts() {
    const d = await this.api(undefined, "?view=drafts");
    await this.page(
      "PRIVATE DRAFTS",
      "Continue a thought from the website or glasses.",
      [
        ...d.drafts.slice(0, 15).map(
          (draft: any) =>
            [
              draft.title || "New thought",
              async () => {
                this.draft = draft;
                await this.compose();
              },
            ] as Action,
        ),
        ["Back", () => this.menu()],
      ],
    );
  }
  private async review() {
    await this.save();
    await this.page(
      "REVIEW YOUR WORDS",
      `Title: ${this.draft.title}\n${this.draft.body}`,
      [
        ["Continue to confirmation", () => this.confirm()],
        ["Edit / re-record", () => this.compose()],
      ],
    );
  }
  private async confirm() {
    const me = await this.api(undefined, "?view=me");
    await this.page(
      "PUBLISH TO THE WORLD?",
      `@${me.user?.username || "member"} → ${this.channels.find((c) => c.id === this.draft.channel_id)?.name}\n${this.draft.title}\nThis publishes your reviewed text.`,
      [
        [
          "Confirm publish",
          async () => {
            const d = await this.api({
              action: "publish",
              id: this.draft.id,
              revision: this.draft.revision,
            });
            this.draft = null;
            await this.readPost(d.id);
          },
        ],
        ["Review again", () => this.review()],
        ["Keep private", () => this.compose()],
      ],
    );
  }
  private async record(field: "title" | "body" | "reply") {
    this.chunks = [];
    this.bytes = 0;
    this.recording = field;
    await this.page(
      `RECORD ${field.toUpperCase()}`,
      "Speak naturally. Tap Stop when finished.\nYour words stay private until reviewed.",
      [
        ["Stop & transcribe", () => this.stopRecording(true)],
        [
          "Cancel recording",
          async () => {
            await this.stopRecording(false);
            await this.returnTo();
          },
        ],
      ],
    );
    try {
      await this.bridge.audioControl(true);
    } catch (e) {
      this.recording = null;
      throw e;
    }
    this.timer = setTimeout(
      () => {
        if (this.recording)
          void this.stopRecording(true).catch((e) => this.note(e.message));
      },
      field === "title" ? 20000 : 90000,
    );
  }
  private async stopRecording(transcribe: boolean) {
    if (!this.recording) return;
    const field = this.recording;
    this.recording = null;
    if (this.timer) clearTimeout(this.timer);
    await this.bridge.audioControl(false);
    if (!transcribe) {
      this.chunks = [];
      return;
    }
    await this.page(
      "TRANSCRIBING",
      "Your recording is private. Review the text next.",
      [["Please wait", async () => {}]],
    );
    const expected = this.revision;
    const bytes = new Uint8Array(this.bytes);
    let off = 0;
    for (const c of this.chunks) {
      bytes.set(c, off);
      off += c.length;
    }
    this.chunks = [];
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const r = await fetch("https://sophicon-api.vercel.app/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ audio: btoa(binary), language: "en" }),
      signal: AbortSignal.timeout(45000),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Transcription unavailable.");
    if (!this.active || expected !== this.revision) return;
    if (field === "reply") {
      const request_id = crypto.randomUUID();
      await this.page("REVIEW REPLY", d.text || "No speech heard.", [
        [
          "Confirm publish reply",
          async () => {
            await this.api({
              action: "comment",
              post_id: this.post.id,
              body: d.text,
              request_id,
            });
            await this.readPost(this.post.id);
          },
        ],
        ["Re-record reply", () => this.record("reply")],
        ["Keep private / cancel", () => this.readPost(this.post.id)],
      ]);
    } else {
      this.draft[field] = d.text || "";
      await this.save();
      await this.compose();
    }
  }
  private globeData: any = null;
  private globeModel: any = null;
  private geography: any = null;
  private globeCamera = {center:[12,25],zoom:1};
  private globeCountry: any = null;
  private globeRegion: any = null;
  private globeRegions: any[] = [];
  private async globe() {
    const revision = this.revision;
    await this.page("THOUGHT GLOBE", "Loading the shared world…", [["Back", () => this.menu()]]);
    const [data, model] = await Promise.all([this.api(undefined, "?view=globe"), thoughtGlobeModule()]);
    const geography = await model.loadGeography();
    if (!this.active || revision !== this.revision) return;
    this.globeData = data; this.globeModel = model; this.geography = geography;
    this.globeCamera = {center:[12,25],zoom:1}; this.globeCountry = null; this.globeRegion = null; this.globeRegions = [];
    await this.globeFrame();
  }
  private async globePlaces(states = false, offset = 0) {
    const rows = [...(states ? this.globeRegions : this.geography.countries)].sort((a:any,b:any) => a.name.localeCompare(b.name));
    const actions: Action[] = rows.slice(offset,offset+7).map((place:any):Action => [place.name.slice(0,60), async () => {
      if (states) { this.globeRegion = place; this.globeCamera = this.globeModel.fitCamera(place.polygons); }
      else {
        const revision = this.revision;
        const regions = await this.geography.regions(place.code);
        if (!this.active || revision !== this.revision) return;
        this.globeCountry = place; this.globeRegion = null; this.globeRegions = regions;
        this.globeCamera = this.globeModel.fitCamera(this.geography.outlines[place.code] || []);
      }
      await this.globeFrame();
    }]);
    if(offset+7<rows.length)actions.push(["Next places >",()=>this.globePlaces(states,offset+7)]);
    if(offset)actions.push(["< Previous places",()=>this.globePlaces(states,Math.max(0,offset-7))]);
    actions.push(["Back to globe",()=>this.globeFrame()]);
    await this.page(states ? "STATES / REGIONS" : "COUNTRIES", `${states ? this.globeCountry.name : 'World'} · ${rows.length} places
Select to focus the globe.`,actions);
  }
  private async globeFrame() {
    if(!this.active)return;
    const country=this.globeCountry,region=this.globeRegion,d=this.globeData;
    this.actions = [
      ["Turn globe >",async()=>{this.globeCamera.center[0]=this.globeModel.wrapLongitude(this.globeCamera.center[0]+20/this.globeCamera.zoom);await this.globeFrame();}],
      ["Choose country",()=>this.globePlaces()],
      ...(country && this.globeRegions.length ? [["States / regions",()=>this.globePlaces(true)] as Action] : []),
      ["Regional activity",()=>this.page("THOUGHT ACTIVITY", d.regions.map((r:any)=>`${r.region}: ${r.thoughts} thoughts`).join("\n") || "Lights appear after five people share in a broad region. No precise locations.", [["Back to globe",()=>this.globeFrame()]])],
      ["World view",async()=>{this.globeCamera={center:[12,25],zoom:1};this.globeCountry=null;this.globeRegion=null;this.globeRegions=[];await this.globeFrame();}],
      ["Back to Aphorica",()=>this.menu()],
    ];
    await this.bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum:4,
      textObject:[new TextContainerProperty({containerID:81,containerName:"aph-title",xPosition:222,yPosition:15,width:334,height:85,content:`THOUGHT GLOBE\n${region?.name || country?.name || 'World'}\n${d.total} thoughts / 24h · broad regions`,isEventCapture:0})],
      listObject:[new ListContainerProperty({containerID:83,containerName:"aph-actions",xPosition:222,yPosition:110,width:334,height:160,isEventCapture:1,itemContainer:new ListItemContainerProperty({itemCount:this.actions.length,itemWidth:320,isItemSelectBorderEn:1,itemName:this.actions.map(a=>a[0])})})],
      imageObject:[new ImageContainerProperty({containerID:84,containerName:"aph-globe-t",xPosition:18,yPosition:36,width:190,height:95}),new ImageContainerProperty({containerID:85,containerName:"aph-globe-b",xPosition:18,yPosition:131,width:190,height:95})],
    }));
    const canvas=document.createElement('canvas');
    this.globeModel.drawGlobe(canvas,this.geography,this.globeCamera,{country,region,regions:this.globeRegions,activity:d.regions});
    await pushThoughtGlobe(this.bridge,canvas);
  }
  private async note(text: string) {
    await this.page("APHORICA", text, [["Back", () => this.menu()]]);
  }
  async handle(event: EvenHubEvent) {
    if (event.audioEvent) {
      if (this.recording && event.audioEvent.audioPcm) {
        const c = new Uint8Array(event.audioEvent.audioPcm);
        if (this.bytes + c.length <= 2880000) {
          this.chunks.push(c);
          this.bytes += c.length;
        }
      }
      return true;
    }
    const type = event.sysEvent?.eventType ?? 0;
    if (event.sysEvent && type >= 4) {
      if (type === 5 || type === 6 || type === 7)
        await this.stopRecording(false);
      if (type === 4) await this.menu();
      return false;
    }
    if (this.busy) return true;
    this.busy = true;
    try {
      if (event.sysEvent && type === 3) {
        await this.stopRecording(false);
        await this.menu();
      } else if (event.listEvent && (event.listEvent.eventType ?? 0) === 0)
        await this.actions[event.listEvent.currentSelectItemIndex ?? 0]?.[1]();
    } catch (e) {
      await this.note((e as Error).message);
    } finally {
      this.busy = false;
    }
    return true;
  }
}

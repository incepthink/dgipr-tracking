/* Sample data for the Insights pages (design canvas "DGIPR Insights", Core page). There is no API yet that lists
   posts with their metrics over time (Publication.metrics is overwritten on each collection), so every page shows
   these figures under a "Sample data" label. Captions and citizen questions stay in Marathi in both languages. */

export type Bi = { mr: string; en: string };
export type Platform = "facebook" | "instagram" | "x" | "youtube";
export type Format = "short_video" | "long_video" | "poster" | "text";

export interface Office { code: string; name_mr: string; name_en: string }

const O = (code: string, name_mr: string, name_en: string): Office => ({ code, name_mr, name_en });
export const OFFICES = {
  solapur: O("solapur", "सोलापूर", "Solapur"), beed: O("beed", "बीड", "Beed"), dgipr: O("dgipr", "महासंचालनालय", "DGIPR"),
  jalna: O("jalna", "जालना", "Jalna"), nanded: O("nanded", "नांदेड", "Nanded"), kolhapur: O("kolhapur", "कोल्हापूर", "Kolhapur"),
  nashik: O("nashik", "नाशिक", "Nashik"), pune: O("pune", "पुणे", "Pune"), latur: O("latur", "लातूर", "Latur"),
  gadchiroli: O("gadchiroli", "गडचिरोली", "Gadchiroli"), dharashiv: O("dharashiv", "धाराशिव", "Dharashiv"),
  nagpur: O("nagpur", "नागपूर", "Nagpur"), sambhajinagar: O("sambhajinagar", "छ. संभाजीनगर", "Chh. Sambhajinagar"),
  sangli: O("sangli", "सांगली", "Sangli"), sindhudurg: O("sindhudurg", "सिंधुदुर्ग", "Sindhudurg"),
  amravati: O("amravati", "अमरावती", "Amravati"), hingoli: O("hingoli", "हिंगोली", "Hingoli"),
};

export const CAMPAIGN = { mr: "दुष्काळ उपाययोजना", en: "Drought relief" };
export const WEEK = { start: "2026-10-19", end: "2026-10-25" };

export interface Post {
  id: string; caption: string; office: Office; platform: Platform; format: Format; daysAgo: number;
  posted: Bi; views: number; mult: number; tint: string;
  /** Views over 0,1,3,6,12,24,48,72,120,168 h (thousands); absent = drawn from the usual curve times `mult`. */
  curve?: number[];
  /** A moment marked on the growth chart. */
  event?: { hour: number; label: Bi };
  platforms?: { platform: Platform; views: number }[];
  platformsNote?: Bi;
  sentiment?: { pos: number; neu: number; neg: number; comments: number };
  topQuestion?: { n: number; mr: string; en: string };
  why?: { t: Bi; b: Bi }[];
}

const P = (id: string, caption: string, office: Office, platform: Platform, format: Format, daysAgo: number,
  posted: Bi, views: number, mult: number, tint: string, more: Partial<Post> = {}): Post =>
  ({ id, caption, office, platform, format, daysAgo, posted, views, mult, tint, ...more });

export const POSTS: Post[] = [
  P("mohol-tanker", "मोहोळ तालुक्यात टँकरने पाणीपुरवठा सुरू — जिल्हाधिकाऱ्यांची पाहणी", OFFICES.solapur, "instagram", "short_video", 2,
    { mr: "गुरु. २३ ऑक्टो., सायं. ७", en: "Thu 23 Oct, 7 pm" }, 382000, 4.6, "#c9b28a", {
      curve: [0, 12, 48, 96, 170, 252, 318, 350, 374, 382],
      event: { hour: 9, label: { mr: "राज्य खात्याने शेअर केले", en: "State account shared it" } },
      platforms: [
        { platform: "instagram", views: 382000 }, { platform: "facebook", views: 146000 },
        { platform: "youtube", views: 62000 }, { platform: "x", views: 18000 },
      ],
      platformsNote: { mr: "X वर सर्वात कमी: १४ तास उशिरा आणि उपशीर्षकांशिवाय टाकले.", en: "X did worst: it went up 14 hours later and without captions." },
      sentiment: { pos: 72, neu: 19, neg: 9, comments: 2240 },
      topQuestion: { n: 214, mr: "आमच्या गावाला टँकर कधी येणार?", en: "When will the tanker come to our village?" },
      why: [
        { t: { mr: "जिल्हाधिकारी स्वतः कॅमेऱ्यावर बोलले", en: "The Collector spoke on camera" }, b: { mr: "खरी व्यक्ती असलेल्या पोस्टना दुप्पट प्रतिसाद मिळतो.", en: "Posts with a real person do twice as well." } },
        { t: { mr: "लहान, मराठी उपशीर्षकांसह", en: "Short, with Marathi captions" }, b: { mr: "४८ सेकंद — बहुतेक लोक आवाज बंद ठेवून पाहतात.", en: "48 seconds — most people watch on mute." } },
        { t: { mr: "सायं. ७ वाजता, राज्य खात्याने शेअर केले", en: "Posted at 7 pm, shared by the state account" }, b: { mr: "संध्याकाळी आपले प्रेक्षक ऑनलाइन असतात.", en: "Evening is when our audience is online." } },
      ],
    }),
  P("fodder-visit", "चारा छावणीला पालकमंत्र्यांची भेट", OFFICES.beed, "facebook", "long_video", 1,
    { mr: "शुक्र. २४ ऑक्टो., सायं. ६", en: "Fri 24 Oct, 6 pm" }, 124000, 3.1, "#9fb3a0"),
  P("how-to-apply", "दुष्काळग्रस्त तालुक्यांसाठी मदत — अर्ज कसा करावा", OFFICES.dgipr, "x", "short_video", 0,
    { mr: "आज, दु. १", en: "Today, 1 pm" }, 86000, 2.8, "#a9b8cf"),
  P("crop-insurance-qa", "पीक विमा: शेतकऱ्यांचे प्रश्न, अधिकाऱ्यांची उत्तरे", OFFICES.jalna, "youtube", "long_video", 3,
    { mr: "बुध. २२ ऑक्टो., सायं. ८", en: "Wed 22 Oct, 8 pm" }, 71000, 2.4, "#d0a99a"),
  P("kinwat-schedule", "किनवट तालुक्यातील टँकर वेळापत्रक जाहीर", OFFICES.nanded, "facebook", "poster", 2,
    { mr: "गुरु. २३ ऑक्टो., सकाळी ११", en: "Thu 23 Oct, 11 am" }, 64000, 1.9, "#b7a7c4"),
  P("jalyukt-review", "जलयुक्त शिवार: गावागावातील कामांचा आढावा", OFFICES.kolhapur, "instagram", "short_video", 4,
    { mr: "मंगळ. २१ ऑक्टो., सायं. ७", en: "Tue 21 Oct, 7 pm" }, 48000, 1.7, "#a5c0bd"),
  P("free-fodder-list", "जनावरांसाठी मोफत चारा — केंद्रांची यादी", OFFICES.nashik, "facebook", "poster", 3,
    { mr: "बुध. २२ ऑक्टो., दु. १२", en: "Wed 22 Oct, 12 pm" }, 52000, 1.6, "#cbbf95"),
  P("save-water", "पाणी जपून वापरा — नागरिकांना आवाहन", OFFICES.pune, "facebook", "poster", 5,
    { mr: "सोम. २० ऑक्टो., सकाळी १०", en: "Mon 20 Oct, 10 am" }, 33000, 1.0, "#c8b7a3"),
  P("press-note-meeting", "प्रेस नोट: दुष्काळ निवारण बैठक", OFFICES.latur, "facebook", "text", 2,
    { mr: "गुरु. २३ ऑक्टो., सकाळी ९", en: "Thu 23 Oct, 9 am" }, 6200, 0.4, "#d9dcd4", {
      why: [
        { t: { mr: "फक्त मजकूर, चित्र किंवा व्हिडिओ नाही", en: "Text only, no picture or video" }, b: { mr: "मजकूर पोस्टना नेहमीच्या पोस्टच्या निम्मा प्रतिसाद मिळतो.", en: "Text posts get under half of a usual post." } },
        { t: { mr: "सकाळी ९ वाजता टाकले", en: "Posted at 9 am" }, b: { mr: "सकाळी आपले प्रेक्षक सर्वात कमी असतात.", en: "Mornings are when our audience is smallest." } },
      ],
    }),
  P("lake-desilting", "तलाव गाळमुक्ती अभियानाला सुरुवात", OFFICES.gadchiroli, "instagram", "poster", 4,
    { mr: "मंगळ. २१ ऑक्टो., सकाळी ८", en: "Tue 21 Oct, 8 am" }, 4100, 0.3, "#c2cbb8"),
];

/** A usual post's views over the same hours, as a share of its 7-day total. */
export const CURVE_HOURS = [0, 1, 3, 6, 12, 24, 48, 72, 120, 168];
export const USUAL_SHAPE = [0, 4, 12, 22, 36, 52, 64, 72, 78, 83].map((v) => v / 83);

// ------------------------------------------------------------------------------------------------ overview
export const OVERVIEW = {
  rising: { postId: "how-to-apply", views: 86000, hours: 5, mult: 2.8 },
  views: 4260000, viewsDelta: 38,
  /** Views per day in lakh, Mon..Sun. */
  thisWeek: [4.9, 5.6, 5.1, 6.3, 7.4, 7.0, 6.3], lastWeek: [4.1, 4.6, 3.9, 4.4, 5.2, 4.8, 4.0],
  since: { start: { mr: "१ जुलै २०२६", en: "1 Jul 2026" }, before: 1450, now: 3320, accounts: 142,
    trend: [1450, 1470, 1520, 1490, 1580, 1560, 1640, 1700, 1690, 2240, 2610, 2980, 3320], campaignFrom: 8.5 },
  kpis: [
    { label: { mr: "प्रसिद्ध पोस्ट", en: "Posts published" }, value: "1,284", delta: { mr: "▲ मागील आठवड्यापेक्षा १२%", en: "▲ 12% vs last week" }, good: true },
    { label: { mr: "प्रतिसाद देणारे लोक", en: "People who reacted" }, value: "6.89 L", delta: { mr: "▲ मागील आठवड्यापेक्षा ४१%", en: "▲ 41% vs last week" }, good: true },
    { label: { mr: "पोस्ट करणारे जिल्हे", en: "Districts posting" }, value: "35 / 36", delta: { mr: "हिंगोली शांत आहे", en: "Hingoli is quiet" }, good: false },
  ],
  questions: [
    { n: 1140, mr: "टँकरच्या पाण्यासाठी अर्ज कुठे करायचा?", en: "Where do we apply for tanker water?" },
    { n: 620, mr: "चारा छावणीत नोंदणी कशी करावी?", en: "How do we register at a fodder camp?" },
    { n: 480, mr: "पीक विम्याचे पैसे कधी मिळणार?", en: "When will the crop insurance money come?" },
  ],
  alerts: [
    { level: "bad" as const, title: { mr: "हिंगोलीने ३ दिवस पोस्ट केलेले नाही", en: "Hingoli hasn’t posted for 3 days" }, body: { mr: "शेवटची पोस्ट २२ ऑक्टोबरला.", en: "Last post on 22 Oct." } },
    { level: "warn" as const, title: { mr: "लातूरचे व्ह्यूज निम्म्याने घटले", en: "Latur’s views dropped by half" }, body: { mr: "या आठवड्यातील सर्व पोस्ट मजकूर प्रेस नोट होत्या.", en: "All its posts this week were text press notes." } },
  ],
  tip: {
    title: { mr: "लहान व्हिडिओंना पोस्टरपेक्षा ३ पट व्ह्यूज मिळाले.", en: "Short videos got 3× more views than posters." },
    body: { mr: "एका मिनिटाच्या आत ठेवा, अधिकारी कॅमेऱ्यावर आणा आणि सायं. ७ च्या सुमारास पोस्ट करा.", en: "Keep it under a minute, put an officer on camera, and post around 7 pm." },
  },
};

// ------------------------------------------------------------------------------------------------ districts
/** Engagement rate (%), improvement (points), last week's rank. */
export const DISTRICTS: { office: Office; er: number; imp: number; lastRank: number }[] = [
  { office: OFFICES.solapur, er: 6.1, imp: 1.9, lastRank: 3 }, { office: OFFICES.beed, er: 5.2, imp: 2.3, lastRank: 6 },
  { office: OFFICES.jalna, er: 4.7, imp: 2.6, lastRank: 9 }, { office: OFFICES.kolhapur, er: 4.5, imp: 0.4, lastRank: 2 },
  { office: OFFICES.nashik, er: 4.4, imp: 0.6, lastRank: 4 }, { office: OFFICES.dharashiv, er: 4.2, imp: 1.1, lastRank: 10 },
  { office: OFFICES.nagpur, er: 4.1, imp: 0.2, lastRank: 1 }, { office: OFFICES.sambhajinagar, er: 4.0, imp: 0.5, lastRank: 7 },
  { office: OFFICES.pune, er: 3.9, imp: -0.2, lastRank: 5 }, { office: OFFICES.sangli, er: 3.8, imp: 0.7, lastRank: 12 },
  { office: OFFICES.amravati, er: 3.6, imp: 0.8, lastRank: 14 }, { office: OFFICES.sindhudurg, er: 3.3, imp: 1.2, lastRank: 20 },
];

export const DISTRICT_OF_WEEK = { office: OFFICES.solapur, postId: "mohol-tanker" };

export const NEED_CALL: { office: Office; t: Bi }[] = [
  { office: OFFICES.hingoli, t: { mr: "३ दिवस एकही पोस्ट नाही.", en: "No posts for 3 days." } },
  { office: OFFICES.latur, t: { mr: "२१ ऑक्टो. रोजी १४ पोस्ट नोंदवल्या — आम्हाला फक्त ९ सापडल्या.", en: "Reported 14 posts on 21 Oct — we could find only 9." } },
  { office: OFFICES.gadchiroli, t: { mr: "सर्वात कमी प्रतिसाद (१.४%). या महिन्यात एकही व्हिडिओ नाही.", en: "Lowest engagement (1.4%). No videos this month." } },
];

/** Engagement per post, September → October. */
export const MOVES: { office: Office; sep: number; oct: number }[] = [
  { office: OFFICES.jalna, sep: 2.1, oct: 4.7 }, { office: OFFICES.beed, sep: 2.9, oct: 5.2 },
  { office: OFFICES.solapur, sep: 4.2, oct: 6.1 }, { office: OFFICES.dharashiv, sep: 3.1, oct: 4.2 },
  { office: OFFICES.kolhapur, sep: 4.1, oct: 4.5 }, { office: OFFICES.nagpur, sep: 3.9, oct: 4.1 },
  { office: OFFICES.pune, sep: 4.1, oct: 3.9 }, { office: OFFICES.latur, sep: 3.2, oct: 1.8 },
];

/** Views compared to usual, by day (Mon..Sun) and time slot. */
export const BEST_TIME = [
  [0.7, 0.8, 1.0, 1.9], [0.6, 0.8, 1.1, 2.1], [0.7, 0.9, 1.0, 1.8], [0.8, 0.8, 1.2, 2.0],
  [0.7, 0.8, 1.0, 1.7], [0.9, 1.1, 1.2, 1.5], [1.0, 1.2, 1.3, 1.6],
];

export const FORMATS: { format: Format; mult: number }[] = [
  { format: "short_video", mult: 2.4 }, { format: "long_video", mult: 1.3 }, { format: "poster", mult: 0.8 }, { format: "text", mult: 0.4 },
];

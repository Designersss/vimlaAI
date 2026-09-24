/**
 * Conservative retention-time detector for high-risk personal facts.
 *
 * This is intentionally narrower than a general content classifier: it is a
 * fail-closed backstop for durable Memory/L2 retention when an extraction
 * model misclassifies a clearly sensitive fact as NORMAL. Explicit user
 * actions may still retain matching content, but Memory upgrades it to
 * SENSITIVE + RESTRICTED.
 */
export function containsSensitivePersonalMemoryData(
  value: string,
): boolean {
  const text = value.normalize("NFKC").toLocaleLowerCase();
  if (text.trim().length === 0) return false;

  return SENSITIVE_PERSONAL_PATTERNS.some((pattern) =>
    pattern.test(text),
  );
}

const SENSITIVE_PERSONAL_PATTERNS: readonly RegExp[] = [
  // Health / medical condition and treatment.
  /\b(?:diagnos(?:ed|is)|medical condition|chronic illness|disease|prescription|prescribed|medication|psychiatr(?:y|ic)|mental health|hiv|aids|cancer|diabetes|epilepsy|autis(?:m|tic)|adhd)\b/i,
  /(?:диагноз|диагностирован|диагностирована|заболеван|хроническ(?:ая|ое|ий)|психиатр|психическ(?:ое|ая)|вич|спид|рак|диабет|эпилепс|аутизм|сдвг|принимаю\s+лекарств)/iu,

  // Religion.
  /\b(?:my religion|religious affiliation|i am|i'm)\s+(?:muslim|christian|jewish|hindu|buddhist|sikh|catholic|orthodox)\b/i,
  /(?:моя\s+религи|я\s+(?:мусульманин|мусульманка|христианин|христианка|православн(?:ый|ая)|католик|католичка|иудей|буддист))/iu,

  // Political affiliation / voting preference.
  /\b(?:political affiliation|party membership|registered voter|i vote for|i voted for|i support the .* party|member of the .* party)\b/i,
  /(?:политическ(?:ая|ие)\s+(?:принадлежност|взгляд)|состою\s+в\s+партии|член\s+партии|голосую\s+за|голосовал(?:а)?\s+за)/iu,

  // Trade-union membership.
  /\b(?:trade union member|union membership|member of (?:a|the) (?:trade )?union)\b/i,
  /(?:член\s+профсоюз|состою\s+в\s+профсоюз)/iu,

  // Sexual orientation / intimate life.
  /\b(?:sexual orientation|sex life|intimate life|i am|i'm)\s+(?:gay|lesbian|bisexual|pansexual|asexual)\b/i,
  /(?:сексуальн(?:ая|ой)\s+ориентац|половая\s+жизнь|интимн(?:ая|ой)\s+жизнь|я\s+(?:гей|лесбиянка|бисексуал(?:ен|ьна)?|пансексуал(?:ен|ьна)?))/iu,

  // Criminal history / proceedings.
  /\b(?:criminal record|convicted of|felony conviction|misdemeanor conviction|i was arrested|i am on probation|i'm on probation)\b/i,
  /(?:судимост|я\s+судим|я\s+судима|осужден(?:а)?\s+за|арестован(?:а)?\s+за|уголовн(?:ое|ого)\s+дел)/iu,

  // Race / ethnicity when explicitly self-attributed.
  /\b(?:my race is|my ethnicity is|ethnic background is)\b/i,
  /(?:моя\s+национальност|по\s+национальности\s+я|моя\s+этническ(?:ая|ое)\s+принадлежност)/iu,

  // Biometric identifiers.
  /\b(?:fingerprint template|faceprint|voiceprint|iris scan|retina scan|biometric identifier)\b/i,
  /(?:биометрическ(?:ий|ие)\s+идентификатор|шаблон\s+отпечатк|скан\s+радужк|скан\s+сетчатк)/iu,

  // Precise private residence / financial-account facts.
  /\b(?:my home address is|i live at)\s+\d{1,6}\b/i,
  /(?:мой\s+домашний\s+адрес|я\s+живу\s+по\s+адресу)/iu,
  /\b(?:iban|bank account number|routing number)\b/i,
  /(?:банковск(?:ий|ого)\s+сч[её]т|номер\s+банковского\s+сч[её]та)/iu,
];

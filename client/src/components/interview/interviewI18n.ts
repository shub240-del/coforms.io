export type LanguageCode =
  | "en"
  | "hi"
  | "bn"
  | "ta"
  | "te"
  | "mr"
  | "gu"
  | "kn"
  | "ml"
  | "pa"
  | "od"
  | "es"
  | "fr"
  | "de"
  | "ja"
  | "pt"
  | "zh";

export interface LanguageDef {
  code: LanguageCode;
  label: string;
  native: string;
  flag: string;
  engine?: string;
}

export const SUPPORTED_LANGUAGES: LanguageDef[] = [
  { code: "hi", label: "Hindi", native: "हिन्दी", flag: "🇮🇳", engine: "Sarvam AI" },
  { code: "bn", label: "Bengali", native: "বাংলা", flag: "🇮🇳", engine: "Sarvam AI" },
  { code: "ta", label: "Tamil", native: "தமிழ்", flag: "🇮🇳", engine: "Sarvam AI" },
  { code: "te", label: "Telugu", native: "తెలుగు", flag: "🇮🇳", engine: "Sarvam AI" },
  { code: "mr", label: "Marathi", native: "मराठी", flag: "🇮🇳", engine: "Sarvam AI" },
  { code: "gu", label: "Gujarati", native: "ગુજરાતી", flag: "🇮🇳", engine: "Sarvam AI" },
  { code: "kn", label: "Kannada", native: "ಕನ್ನಡ", flag: "🇮🇳", engine: "Sarvam AI" },
  { code: "ml", label: "Malayalam", native: "മലയാളം", flag: "🇮🇳", engine: "Sarvam AI" },
  { code: "pa", label: "Punjabi", native: "ਪੰਜਾਬੀ", flag: "🇮🇳", engine: "Sarvam AI" },
  { code: "od", label: "Odia", native: "ଓଡ଼ିଆ", flag: "🇮🇳", engine: "Sarvam AI" },
  { code: "en", label: "English", native: "English", flag: "🇺🇸" },
  { code: "es", label: "Spanish", native: "Español", flag: "🇪🇸" },
  { code: "fr", label: "French", native: "Français", flag: "🇫🇷" },
  { code: "de", label: "German", native: "Deutsch", flag: "🇩🇪" },
  { code: "ja", label: "Japanese", native: "日本語", flag: "🇯🇵" },
  { code: "pt", label: "Portuguese", native: "Português", flag: "🇧🇷" },
  { code: "zh", label: "Chinese", native: "中文", flag: "🇨🇳" },
];

export const BROWSER_LOCALE_MAP: Record<LanguageCode, string> = {
  en: "en-US",
  hi: "hi-IN",
  bn: "bn-IN",
  ta: "ta-IN",
  te: "te-IN",
  mr: "mr-IN",
  gu: "gu-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  pa: "pa-IN",
  od: "or-IN",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  ja: "ja-JP",
  pt: "pt-BR",
  zh: "zh-CN",
};

export interface InterviewStrings {
  badge: string;
  welcomeSubtitle: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  preferredLanguage: string;
  modeTitle: string;
  modeVoiceTitle: string;
  modeVoiceDesc: string;
  modeTextTitle: string;
  modeTextDesc: string;
  interruptBtn: string;
  interruptHint: string;
  speakingState: string;
  listeningState: string;
  interimListening: string;
  micDeniedError: string;
  micUnsupportedError: string;
  switchedToTextMode: string;
  clarificationPrompt: string;
  networkErrorRetry: string;
  startInterview: string;
  switchToClassic: string;
  switchToAI: string;
  questionOf: (current: number, total: number) => string;
  required: string;
  optional: string;
  continueBtn: string;
  submitBtn: string;
  submitting: string;
  editAnswer: string;
  typeAnswerPlaceholder: string;
  pressEnter: string;
  thankYouDefault: string;
  responseRecorded: string;
  greeting: (name: string, formTitle: string) => string;
  transitions: string[];
}

export const TRANSLATIONS: Record<string, InterviewStrings> = {
  en: {
    badge: "GUIDED FORM",
    welcomeSubtitle: "Answer a guided form with clear prompts and flexible voice or text input.",
    nameLabel: "Your Name",
    namePlaceholder: "e.g. Alex Morgan",
    emailLabel: "Your Email",
    emailPlaceholder: "alex@example.com",
    preferredLanguage: "Language",
    modeTitle: "Choose how to respond",
    modeVoiceTitle: "Voice responses",
    modeVoiceDesc: "Listen to the assistant and reply naturally by speaking.",
    modeTextTitle: "Text responses",
    modeTextDesc: "Read questions and reply comfortably with your keyboard.",
    interruptBtn: "Interrupt / Speak",
    interruptHint: "Press Space or click to speak",
    speakingState: "AI is speaking…",
    listeningState: "Listening to you…",
    interimListening: "Hearing you: ",
    micDeniedError: "Microphone access was denied. Switching to text mode.",
    micUnsupportedError: "Speech recognition is not supported in this browser. Switching to text mode.",
    switchedToTextMode: "Switched to text chat mode.",
    clarificationPrompt: "Could you please clarify your answer?",
    networkErrorRetry: "Turn failed to process. Retrying with local interpretation…",
    startInterview: "Start guided form",
    switchToClassic: "Switch to classic form",
    switchToAI: "Switch to guided form ✨",
    questionOf: (c, t) => `Question ${c} of ${t}`,
    required: "Required",
    optional: "Optional",
    continueBtn: "Continue",
    submitBtn: "Submit Survey",
    submitting: "Submitting…",
    editAnswer: "Edit",
    typeAnswerPlaceholder: "Type your response here…",
    pressEnter: "Press Enter ↵ to send",
    thankYouDefault: "Thank you for completing this survey!",
    responseRecorded: "Your responses have been securely recorded.",
    greeting: (name, formTitle) =>
      `Hi ${name ? name : "there"}! 👋 Welcome to "${formTitle}". I'll be guiding you through a few quick questions today. Let's make this smooth and engaging!`,
    transitions: [
      "Thanks! Let's move on to the next question.",
      "Got it! Here is the next one for you:",
      "Great answer! Moving forward:",
      "Noted with thanks! Next up:",
      "Awesome, let's keep going:",
    ],
  },
  es: {
    badge: "FORMULARIO GUIADO",
    welcomeSubtitle: "Disfruta de una encuesta conversacional guiada por nuestro asistente de IA.",
    nameLabel: "Tu Nombre",
    namePlaceholder: "ej. Carlos Gómez",
    emailLabel: "Correo Electrónico",
    emailPlaceholder: "carlos@ejemplo.com",
    preferredLanguage: "Idioma",
    modeTitle: "Elige cómo responder",
    modeVoiceTitle: "Respuestas por voz",
    modeVoiceDesc: "Escucha al asistente y responde hablando con naturalidad.",
    modeTextTitle: "Respuestas por texto",
    modeTextDesc: "Lee las preguntas y responde cómodamente con el teclado.",
    interruptBtn: "Interrumpir / Hablar",
    interruptHint: "Presiona Espacio o haz clic para hablar",
    speakingState: "La IA está hablando…",
    listeningState: "Escuchándote…",
    interimListening: "Escuchando: ",
    micDeniedError: "Se denegó el acceso al micrófono. Cambiando a modo texto.",
    micUnsupportedError: "El reconocimiento de voz no es compatible con este navegador. Cambiando a modo texto.",
    switchedToTextMode: "Cambiado a modo chat de texto.",
    clarificationPrompt: "¿Podrías aclarar tu respuesta, por favor?",
    networkErrorRetry: "Error al procesar el turno. Reintentando con interpretación local…",
    startInterview: "Iniciar formulario guiado",
    switchToClassic: "Cambiar a formulario clásico",
    switchToAI: "Cambiar al formulario guiado ✨",
    questionOf: (c, t) => `Pregunta ${c} de ${t}`,
    required: "Obligatorio",
    optional: "Opcional",
    continueBtn: "Continuar",
    submitBtn: "Enviar Encuesta",
    submitting: "Enviando…",
    editAnswer: "Editar",
    typeAnswerPlaceholder: "Escribe tu respuesta aquí…",
    pressEnter: "Presiona Enter ↵ para enviar",
    thankYouDefault: "¡Muchas gracias por completar la encuesta!",
    responseRecorded: "Tus respuestas han sido registradas de forma segura.",
    greeting: (name, formTitle) =>
      `¡Hola ${name ? name : ""}! 👋 Te damos la bienvenida a "${formTitle}". Te acompañaré a través de unas breves preguntas. ¡Comencemos!`,
    transitions: [
      "¡Entendido! Pasemos a la siguiente pregunta.",
      "¡Perfecto! Aquí tienes la siguiente:",
      "¡Excelente respuesta! Continuemos:",
      "Anotado con éxito. Siguiente pregunta:",
      "¡Muy bien! Sigamos avanzando:",
    ],
  },
  fr: {
    badge: "FORMULAIRE GUIDÉ",
    welcomeSubtitle: "Profitez d'un sondage interactif et fluide guidé par notre assistant IA.",
    nameLabel: "Votre Nom",
    namePlaceholder: "ex. Camille Dupont",
    emailLabel: "Votre Email",
    emailPlaceholder: "camille@exemple.com",
    preferredLanguage: "Langue",
    modeTitle: "Choisissez votre mode de réponse",
    modeVoiceTitle: "Réponses vocales",
    modeVoiceDesc: "Écoutez l'assistant et répondez naturellement à la voix.",
    modeTextTitle: "Réponses par écrit",
    modeTextDesc: "Lisez les questions et répondez tranquillement au clavier.",
    interruptBtn: "Interrompre / Parler",
    interruptHint: "Appuyez sur Espace ou cliquez pour parler",
    speakingState: "L'IA s'exprime…",
    listeningState: "À votre écoute…",
    interimListening: "En écoute : ",
    micDeniedError: "Accès au microphone refusé. Passage au mode texte.",
    micUnsupportedError: "La reconnaissance vocale n'est pas supportée par ce navigateur. Passage au mode texte.",
    switchedToTextMode: "Basculé en mode texte.",
    clarificationPrompt: "Pourriez-vous préciser votre réponse s'il vous plaît ?",
    networkErrorRetry: "Échec du traitement du tour. Nouvel essai avec interprétation locale…",
    startInterview: "Commencer le formulaire guidé",
    switchToClassic: "Passer au formulaire classique",
    switchToAI: "Passer au formulaire guidé ✨",
    questionOf: (c, t) => `Question ${c} sur ${t}`,
    required: "Requis",
    optional: "Facultatif",
    continueBtn: "Continuer",
    submitBtn: "Envoyer le questionnaire",
    submitting: "Envoi en cours…",
    editAnswer: "Modifier",
    typeAnswerPlaceholder: "Écrivez votre réponse ici…",
    pressEnter: "Appuyez sur Entrée ↵ pour envoyer",
    thankYouDefault: "Merci d'avoir complété ce questionnaire !",
    responseRecorded: "Vos réponses ont été enregistrées avec succès.",
    greeting: (name, formTitle) =>
      `Bonjour ${name ? name : ""} ! 👋 Bienvenue sur "${formTitle}". Je serai votre guide pour ces quelques questions. C'est parti !`,
    transitions: [
      "C'est bien noté ! Passons à la question suivante.",
      "Parfait ! Voici la suite :",
      "Très bien ! Continuons ensemble :",
      "C'est enregistré. Question suivante :",
      "Super, poursuivons :",
    ],
  },
  de: {
    badge: "GEFÜHRTES FORMULAR",
    welcomeSubtitle: "Erleben Sie eine geführte, persönliche Umfrage mit unserem KI-Assistenten.",
    nameLabel: "Ihr Name",
    namePlaceholder: "z.B. Jonas Weber",
    emailLabel: "Ihre E-Mail",
    emailPlaceholder: "jonas@beispiel.de",
    preferredLanguage: "Sprache",
    modeTitle: "Wählen Sie Ihre Antwortmethode",
    modeVoiceTitle: "Sprachantworten",
    modeVoiceDesc: "Hören Sie dem Assistenten zu und antworten Sie ganz natürlich per Sprache.",
    modeTextTitle: "Textantworten",
    modeTextDesc: "Lesen Sie die Fragen und antworten Sie bequem per Tastatur.",
    interruptBtn: "Unterbrechen / Sprechen",
    interruptHint: "Leertaste drücken oder klicken zum Sprechen",
    speakingState: "KI spricht gerade…",
    listeningState: "Ich höre Ihnen zu…",
    interimListening: "Erkannt: ",
    micDeniedError: "Mikrofonzugriff wurde verweigert. Wechsel zum Textmodus.",
    micUnsupportedError: "Spracherkennung wird von diesem Browser nicht unterstützt. Wechsel zum Textmodus.",
    switchedToTextMode: "In den Textmodus gewechselt.",
    clarificationPrompt: "Könnten Sie Ihre Antwort bitte präzisieren?",
    networkErrorRetry: "Verarbeitung fehlgeschlagen. Wiederholung mit lokaler Interpretation…",
    startInterview: "Geführtes Formular starten",
    switchToClassic: "Zu klassischer Ansicht wechseln",
    switchToAI: "Zum geführten Formular wechseln ✨",
    questionOf: (c, t) => `Frage ${c} von ${t}`,
    required: "Erforderlich",
    optional: "Optional",
    continueBtn: "Weiter",
    submitBtn: "Umfrage absenden",
    submitting: "Wird gesendet…",
    editAnswer: "Bearbeiten",
    typeAnswerPlaceholder: "Geben Sie Ihre Antwort ein…",
    pressEnter: "Drücken Sie Enter ↵ zum Senden",
    thankYouDefault: "Vielen Dank für Ihre Teilnahme!",
    responseRecorded: "Ihre Antworten wurden sicher gespeichert.",
    greeting: (name, formTitle) =>
      `Hallo ${name ? name : ""}! 👋 Willkommen bei "${formTitle}". Ich führe Sie durch ein paar kurze Fragen. Los geht's!`,
    transitions: [
      "Verstanden! Kommen wir zur nächsten Frage.",
      "Vielen Dank! Hier ist die nächste Frage:",
      "Wunderbar! Machen wir direkt weiter:",
      "Notiert. Als Nächstes:",
      "Klasse, weiter geht's:",
    ],
  },
  hi: {
    badge: "आसान बातचीत वाला फ़ॉर्म",
    welcomeSubtitle: "हमारे एआई सहायक के साथ एक संवादात्मक और सहज सर्वे का अनुभव करें।",
    nameLabel: "आपका नाम",
    namePlaceholder: "उदा. राहुल शर्मा",
    emailLabel: "ईमेल आईडी",
    emailPlaceholder: "rahul@example.com",
    preferredLanguage: "भाषा",
    modeTitle: "जवाब देने का तरीका चुनें",
    modeVoiceTitle: "आवाज़ से जवाब दें",
    modeVoiceDesc: "सहायक को सुनें और बोलकर स्वाभाविक रूप से उत्तर दें।",
    modeTextTitle: "लिखकर जवाब दें",
    modeTextDesc: "प्रश्नों को पढ़ें और कीबोर्ड से आराम से उत्तर लिखें।",
    interruptBtn: "रोकें / बोलें",
    interruptHint: "बोलने के लिए Space दबाएँ या क्लिक करें",
    speakingState: "एआई बोल रहा है…",
    listeningState: "सुन रहा हूँ…",
    interimListening: "सुनाई दे रहा है: ",
    micDeniedError: "माइक की अनुमति नहीं मिली। टेक्स्ट मोड पर स्विच किया जा रहा है।",
    micUnsupportedError: "इस ब्राउज़र में स्पीच रिकॉग्निशन समर्थित नहीं है। टेक्स्ट मोड पर स्विच किया गया।",
    switchedToTextMode: "टेक्स्ट चैट मोड चालू किया गया।",
    clarificationPrompt: "क्या आप कृपया अपने उत्तर को थोड़ा स्पष्ट कर सकते हैं?",
    networkErrorRetry: "प्रक्रिया विफल रही। स्थानीय व्याख्या के साथ पुनः प्रयास किया जा रहा है…",
    startInterview: "गाइडेड फ़ॉर्म शुरू करें",
    switchToClassic: "पारंपरिक फॉर्म पर जाएँ",
    switchToAI: "गाइडेड फ़ॉर्म पर जाएँ ✨",
    questionOf: (c, t) => `प्रश्न ${c} / ${t}`,
    required: "अनिवार्य",
    optional: "वैकल्पिक",
    continueBtn: "आगे बढ़ें",
    submitBtn: "सर्वे सबमिट करें",
    submitting: "सबमिट हो रहा है…",
    editAnswer: "बदलें",
    typeAnswerPlaceholder: "अपना उत्तर यहाँ लिखें…",
    pressEnter: "भेजने के लिए Enter दबाएँ",
    thankYouDefault: "इस सर्वे को पूरा करने के लिए आपका बहुत-बहुत धन्यवाद!",
    responseRecorded: "आपके उत्तर सुरक्षित रूप से दर्ज कर लिए गए हैं।",
    greeting: (name, formTitle) =>
      `नमस्ते ${name ? name + " जी" : ""}! 👋 "${formTitle}" में आपका स्वागत है। मैं इस सर्वे में आपका एआई गाइड हूँ। चलिए शुरू करते हैं!`,
    transitions: [
      "धन्यवाद! चलिए अगले प्रश्न की ओर बढ़ते हैं।",
      "समझ गया! यह रहा आपका अगला प्रश्न:",
      "शानदार उत्तर! आगे बढ़ते हैं:",
      "नोट कर लिया गया है। अगला सवाल:",
      "बहुत बढ़िया, आगे चलते हैं:",
    ],
  },
  ja: {
    badge: "ガイド付きフォーム",
    welcomeSubtitle: "AIアシスタントとの自然な対話形式でアンケートに回答いただけます。",
    nameLabel: "お名前",
    namePlaceholder: "例: 山田 太郎",
    emailLabel: "メールアドレス",
    emailPlaceholder: "yamada@example.jp",
    preferredLanguage: "言語",
    modeTitle: "回答方法を選択",
    modeVoiceTitle: "音声で回答",
    modeVoiceDesc: "AIの音声を聞き、声を出して自然に回答できます。",
    modeTextTitle: "テキストで回答",
    modeTextDesc: "質問を読み、キーボードで落ち着いて回答できます。",
    interruptBtn: "割り込んで話す",
    interruptHint: "Spaceキーまたはクリックで発言",
    speakingState: "AIが話しています…",
    listeningState: "お聞きしています…",
    interimListening: "聞き取り中: ",
    micDeniedError: "マイクの使用が拒否されました。テキストモードに切り替えます。",
    micUnsupportedError: "お使いのブラウザは音声認識に対応していません。テキストモードに切り替えます。",
    switchedToTextMode: "テキストチャットモードに切り替えました。",
    clarificationPrompt: "回答内容をもう少し詳しく教えていただけますか？",
    networkErrorRetry: "ターンの処理に失敗しました。ローカル解析で再試行します…",
    startInterview: "ガイド付きフォームを開始",
    switchToClassic: "通常フォームに切替",
    switchToAI: "ガイド付きフォームに切替 ✨",
    questionOf: (c, t) => `質問 ${c} / ${t}`,
    required: "必須",
    optional: "任意",
    continueBtn: "次へ進む",
    submitBtn: "アンケートを送信",
    submitting: "送信中…",
    editAnswer: "編集",
    typeAnswerPlaceholder: "回答を入力してください…",
    pressEnter: "Enter ↵ で送信",
    thankYouDefault: "アンケートにご協力いただき誠にありがとうございました！",
    responseRecorded: "回答は安全に記録されました。",
    greeting: (name, formTitle) =>
      `こんにちは ${name ? name + "様" : ""}！👋「${formTitle}」へようこそ。本日のAIナビゲーターです。それでは始めましょう！`,
    transitions: [
      "承知いたしました！次の質問へ進みます。",
      "ありがとうございます！続いての質問はこちらです：",
      "回答を受け付けました。次へ進みましょう：",
      "記録しました。続いての質問です：",
      "順調です、次へ進みましょう：",
    ],
  },
  pt: {
    badge: "FORMULÁRIO GUIADO",
    welcomeSubtitle: "Uma experiência de pesquisa interativa e conversacional com inteligência artificial.",
    nameLabel: "Seu Nome",
    namePlaceholder: "ex. Lucas Silva",
    emailLabel: "Seu E-mail",
    emailPlaceholder: "lucas@exemplo.com",
    preferredLanguage: "Idioma",
    modeTitle: "Escolha como responder",
    modeVoiceTitle: "Respostas por voz",
    modeVoiceDesc: "Ouça o assistente e responda naturalmente falando.",
    modeTextTitle: "Respostas por texto",
    modeTextDesc: "Leia as perguntas e responda com calma pelo teclado.",
    interruptBtn: "Interromper / Falar",
    interruptHint: "Pressione Espaço ou clique para falar",
    speakingState: "A IA está falando…",
    listeningState: "Ouvindo você…",
    interimListening: "Ouvindo: ",
    micDeniedError: "Acesso ao microfone negado. Mudando para modo texto.",
    micUnsupportedError: "Reconhecimento de voz não suportado neste navegador. Mudando para modo texto.",
    switchedToTextMode: "Modo chat de texto ativado.",
    clarificationPrompt: "Poderia esclarecer sua resposta, por favor?",
    networkErrorRetry: "Falha ao processar resposta. Tentando novamente com interpretação local…",
    startInterview: "Iniciar formulário guiado",
    switchToClassic: "Mudar para formulário padrão",
    switchToAI: "Mudar para formulário guiado ✨",
    questionOf: (c, t) => `Pergunta ${c} de ${t}`,
    required: "Obrigatório",
    optional: "Opcional",
    continueBtn: "Continuar",
    submitBtn: "Enviar Pesquisa",
    submitting: "Enviando…",
    editAnswer: "Editar",
    typeAnswerPlaceholder: "Digite sua resposta aqui…",
    pressEnter: "Pressione Enter ↵ para enviar",
    thankYouDefault: "Muito obrigado por responder à pesquisa!",
    responseRecorded: "Suas respostas foram gravadas com segurança.",
    greeting: (name, formTitle) =>
      `Olá ${name ? name : ""}! 👋 Seja bem-vindo(a) a "${formTitle}". Serei seu guia nesta pesquisa. Vamos começar!`,
    transitions: [
      "Perfeito! Vamos para a próxima pergunta.",
      "Entendido! Aqui está a próxima:",
      "Ótima resposta! Continuando:",
      "Anotado com sucesso. Próxima pergunta:",
      "Muito bem, vamos em frente:",
    ],
  },
  zh: {
    badge: "AI 故事对话问卷",
    welcomeSubtitle: "在 AI 助手的引导下，以自然的对话方式完成问卷。",
    nameLabel: "您的姓名",
    namePlaceholder: "例如：张华",
    emailLabel: "电子邮箱",
    emailPlaceholder: "zhang@example.com",
    preferredLanguage: "语言",
    modeTitle: "选择您的回答方式",
    modeVoiceTitle: "语音回答",
    modeVoiceDesc: "聆听 AI 助手的提问，并通过语音自然回答。",
    modeTextTitle: "静音文字对话",
    modeTextDesc: "阅读问题并通过键盘输入回答，适合安静环境。",
    interruptBtn: "打断 / 发言",
    interruptHint: "按空格键或点击开始说话",
    speakingState: "AI 正在说话…",
    listeningState: "正在倾听…",
    interimListening: "已听到：",
    micDeniedError: "麦克风权限被拒绝，已自动切换到文字模式。",
    micUnsupportedError: "当前浏览器不支持语音识别，已自动切换到文字模式。",
    switchedToTextMode: "已切换至文字对话模式。",
    clarificationPrompt: "请问能进一步说明您的回答吗？",
    networkErrorRetry: "对话处理失败，正在尝试本地解析…",
    startInterview: "开始引导式问卷",
    switchToClassic: "切换到经典表单",
    switchToAI: "切换到引导式问卷 ✨",
    questionOf: (c, t) => `第 ${c} 题 / 共 ${t} 题`,
    required: "必填",
    optional: "选填",
    continueBtn: "继续",
    submitBtn: "提交问卷",
    submitting: "正在提交…",
    editAnswer: "修改",
    typeAnswerPlaceholder: "在此输入您的回答…",
    pressEnter: "按 Enter ↵ 发送",
    thankYouDefault: "衷心感谢您完成本次问卷！",
    responseRecorded: "您的回答已被安全记录。",
    greeting: (name, formTitle) =>
      `您好 ${name ? name : ""}！👋 欢迎来到“${formTitle}”。我是今天的 AI 向导，让我们轻松愉快地开始吧！`,
    transitions: [
      "收到！让我们进入下一个问题。",
      "好的，这里是下一个问题：",
      "感谢您的回答！继续下一题：",
      "已记录，下一题：",
      "非常好，我们继续：",
    ],
  },
};

// Concept emoji classifier — keyword-based, no AI cost. Order matters:
// more specific sport names check first so "baseball" doesn't fall
// through to a generic ball bucket. Word boundaries (\b) keep
// "basketball" from matching inside "basket-shaped" or vice versa.
//
// Subject-gated: math courses get all the buckets; physics gets the
// physics-flavored ones (🚀); chemistry gets a flask. Avoids the
// chemistry-course-shows-rocket-for-"reagent-cost" mismatch.
export function conceptEmoji(title: string, question: string, subject: string): string {
  const text = (title + " " + question).toLowerCase();

  if (subject === "chemistry") {
    if (/\b(reaction|molecule|bond|acid|base|ph|reagent|compound)\b/.test(text)) return "🧪";
    if (/\b(temperature|heat|kelvin|celsius)\b/.test(text)) return "🌡️";
    return "⚗️";
  }

  if (subject === "physics") {
    if (/\brocket\b|\blaunch(ed|ing)?\b|\bprojectile\b/.test(text)) return "🚀";
    if (/\b(force|newton|gravity|mass|acceleration|momentum)\b/.test(text)) return "⚙️";
    if (/\b(wave|frequency|amplitude|wavelength|hertz)\b/.test(text)) return "〰️";
    if (/\b(circuit|voltage|current|resistance|ohm|watt)\b/.test(text)) return "⚡";
    return "🔬";
  }

  // math (default)

  // Sports — each gets its own emoji, checked specific-to-general
  if (/\bbaseball\b/.test(text)) return "⚾";
  if (/\bbasketball\b/.test(text)) return "🏀";
  if (/\bsoccer\b|\bfootball\b/.test(text)) return "⚽";
  if (/\btennis\b/.test(text)) return "🎾";
  if (/\bhockey\b|\bpuck\b/.test(text)) return "🏒";
  if (/\bfrisbee\b/.test(text)) return "🥏";

  // Physics-flavored launches (still useful in math word problems)
  if (/\brocket\b|\blaunch(ed|ing)?\b|\bprojectile\b/.test(text)) return "🚀";
  if (/\bball\b|\bthrow(n|ing)?\b|\bkick(ed|ing)?\b/.test(text)) return "🏐";

  // Geometry / measurement
  if (/\b(triangle|polygon|angle|circle|square|rectangle|geometry|perimeter|area|volume)\b/.test(text)) return "📐";

  // Graphs / functions
  if (/\b(graph|plot|parabola|curve|axis|coordinate|sketch|function)\b/.test(text)) return "📈";

  // Rates / kinematics
  if (/\b(distance|speed|velocity|rate|hour|minute|km\/h|mph|seconds?)\b/.test(text)) return "⏱️";

  // Statistics / probability
  if (/\b(probability|statistic|mean|median|mode|distribution|sample|standard deviation)\b/.test(text)) return "📊";

  // Money
  if (/\b(money|cost|price|profit|revenue|interest|loan|dollar|salary)\b/.test(text)) return "💰";

  // Real-world catch-all
  if (/\b(word problem|story|real|scenario|context|practical)\b/.test(text)) return "🌍";

  return "📝";
}

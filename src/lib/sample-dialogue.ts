/**
 * Test material for the translator prototype (stage 4). Original lines written for this project:
 * typical TV dialogue with idioms, slang and phrasal verbs, which machine translation gets wrong
 * most often. `reference` is a human-quality translation to compare against (written by Claude).
 */
export const QUALITY_SAMPLE: Array<{ en: string; reference: string }> = [
  { en: 'Hey, you got a minute?', reference: 'Эй, у тебя есть минутка?' },
  { en: "I'm gonna need you to calm down.", reference: 'Мне нужно, чтобы ты успокоился.' },
  { en: "We'll figure it out, I promise.", reference: 'Мы с этим разберёмся, обещаю.' },
  { en: 'Cut it out, both of you.', reference: 'Прекратите, оба.' },
  {
    en: "You look like you've seen a ghost.",
    reference: 'Ты выглядишь так, будто увидел привидение.',
  },
  { en: 'Where were you last night?', reference: 'Где ты был прошлой ночью?' },
  { en: "I don't buy it. Something's off.", reference: 'Я в это не верю. Что-то тут не так.' },
  { en: "He's been acting weird all week.", reference: 'Он всю неделю ведёт себя странно.' },
  { en: "Let's call it a day.", reference: 'Давай на сегодня закончим.' },
  {
    en: "Don't beat around the bush. Just tell me.",
    reference: 'Не ходи вокруг да около. Просто скажи.',
  },
  { en: "It's not a big deal.", reference: 'Ничего страшного.' },
  { en: "You've got to be kidding me.", reference: 'Ты, должно быть, шутишь.' },
  { en: "I'll pick you up at eight.", reference: 'Я заеду за тобой в восемь.' },
  { en: "She's out of town until Monday.", reference: 'Её не будет в городе до понедельника.' },
  { en: 'Keep an eye on him.', reference: 'Присмотри за ним.' },
  {
    en: "The coffee here is terrible, but it's hot.",
    reference: 'Кофе здесь ужасный, зато горячий.',
  },
  { en: 'I owe you one.', reference: 'Я твой должник.' },
  { en: 'Mind your own business.', reference: 'Не лезь не в своё дело.' },
  { en: "We're running out of time.", reference: 'У нас заканчивается время.' },
  { en: 'Did anyone see the car leave?', reference: 'Кто-нибудь видел, как уезжала машина?' },
  {
    en: "That's the last thing I need right now.",
    reference: 'Только этого мне сейчас не хватало.',
  },
  { en: "I'm on my way.", reference: 'Я уже еду.' },
  { en: 'Hang in there.', reference: 'Держись.' },
  { en: 'He took the fall for his brother.', reference: 'Он взял вину на себя вместо брата.' },
  { en: 'Give me a break.', reference: 'Да ладно тебе.' },
  { en: "You're not off the hook yet.", reference: 'Ты ещё не выкрутился.' },
  { en: 'Let me sleep on it.', reference: 'Дай мне подумать до завтра.' },
  { en: 'It cost me an arm and a leg.', reference: 'Это обошлось мне в целое состояние.' },
  { en: 'Long story short, we lost the case.', reference: 'Короче говоря, мы проиграли дело.' },
  { en: "Who's in charge here?", reference: 'Кто здесь главный?' },
  { en: "I've got a bad feeling about this.", reference: 'У меня плохое предчувствие.' },
  { en: 'Stay out of it, Sarah.', reference: 'Не вмешивайся, Сара.' },
  {
    en: 'The lab results came back negative.',
    reference: 'Результаты из лаборатории отрицательные.',
  },
  { en: 'Can you swing by the station later?', reference: 'Можешь заскочить в участок попозже?' },
  { en: 'Nobody leaves this room.', reference: 'Никто не выходит из этой комнаты.' },
  { en: "I'm not in the mood for games.", reference: 'Я не в настроении для игр.' },
  {
    en: "He's a decent guy, just a little rough around the edges.",
    reference: 'Он нормальный парень, просто немного неотёсанный.',
  },
  { en: "Don't jump to conclusions.", reference: 'Не делай поспешных выводов.' },
  { en: 'Is that a threat?', reference: 'Это угроза?' },
  { en: 'We should lay low for a while.', reference: 'Нам стоит какое-то время не высовываться.' },
  { en: 'Thanks for having my back.', reference: 'Спасибо, что прикрыл меня.' },
  { en: 'The snow should melt by tomorrow.', reference: 'К завтрашнему дню снег должен растаять.' },
  { en: "I'm sorry for your loss.", reference: 'Соболезную вашей утрате.' },
  { en: "What's the catch?", reference: 'В чём подвох?' },
  { en: 'You heard me.', reference: 'Ты меня слышал.' },
  { en: "This isn't over.", reference: 'Это ещё не конец.' },
  { en: 'Break a leg tonight!', reference: 'Ни пуха ни пера сегодня!' },
  { en: 'I could use a drink.', reference: 'Я бы не отказался выпить.' },
  {
    en: 'Wait, you mean the guy from the diner?',
    reference: 'Подожди, ты имеешь в виду того парня из закусочной?',
  },
  { en: 'Fine. Have it your way.', reference: 'Ладно. Как хочешь.' },
];

const SUBJECTS = [
  'The detective',
  'My neighbor',
  'Our lawyer',
  'The old man',
  'Your sister',
  'The new doctor',
  'A stranger',
  'The mayor',
  'His partner',
  'The waitress',
];
const VERBS = ['found', 'lost', 'hid', 'sold', 'bought'];
const OBJECTS = [
  'a red umbrella',
  'the spare keys',
  'an old photograph',
  'the blue truck',
  'a stack of letters',
];
const PLACES = [
  'near the harbor',
  'behind the school',
  'at the gas station',
  'in the basement',
  'outside the hospital',
  'by the river',
  'on the night train',
];

/**
 * A block of `count` unique English cues for the speed test: the quality sample first, then
 * generated sentences. All different, so a translation cache cannot make the timing look better.
 */
export function speedSample(count = 200): string[] {
  const lines = QUALITY_SAMPLE.map((line) => line.en);
  for (let i = 0; lines.length < count; i++) {
    const subject = SUBJECTS[i % SUBJECTS.length];
    const verb = VERBS[Math.floor(i / SUBJECTS.length) % VERBS.length];
    const object = OBJECTS[Math.floor(i / (SUBJECTS.length * VERBS.length)) % OBJECTS.length];
    const place = PLACES[i % PLACES.length];
    lines.push(`${subject} ${verb} ${object} ${place} yesterday.`);
  }
  return lines.slice(0, count);
}

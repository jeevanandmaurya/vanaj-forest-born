// Passing remarks: what Vanaj and whoever is with him say about the world as it changes around them.
// None of this is story. It hangs on the director's events (rain starting, night falling, a hunter near, the first
// sight of a kind of animal) and on how he is doing, and each line waits its turn: nothing here is ever said over
// a conversation, and nothing repeats until a good while has passed.
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];

// the first time he sees one up close: what he knows about it
const FIRST = {
  chital: [['vanaj', 'Chital. Where there are chital, look up: the langurs drop them leaves.']],
  sambar: [['vanaj', 'A sambar. If she ever bells, it is a big cat. Always.']],
  gaur: [['vanaj', 'Gaur. The biggest thing on four legs here. I walk wide.']],
  boar: [['vanaj', 'Boar. Bad eyes and a worse temper.']],
  peafowl: [['vanaj', "A peacock. He'll scream the whole forest awake if he sees a cat."]],
  langur: [['vanaj', 'Langurs. The best eyes in the forest, and they know it.']],
  bear: [['vanaj', 'A sloth bear. Never surprise one.']],
  mugger: [['vanaj', "A mugger, lying like a log. Logs don't blink."]],
  dhole: [['vanaj', 'Dholes. Hear them whistling to each other?']],
  cow: [['vanaj', 'Like gaur, but soft. Something looks after them.']],
  dog: [['vanaj', "A wolf that isn't afraid of smoke. Strange."]],
};

export class Barks {
  constructor(g) {
    this.g = g; this.t = 20; this.idle = 70;
    g.on('sim', (e) => this.sim(e));
    g.on('rout', (e) => { if ((e.by === 'player' || e.by === 'companion') && !g.world.quiet && g.world.tension < 0.4) g.talk.bark('rout', [[['vanaj', pickOne(['Go on! Run!', "And don't come back!", 'Ha! It ran!'])]]], { cd: 40 }); });
    g.on('greet', (e) => {
      const kid = e.npc.role === 'child', who = e.npc === g.story.aaji ? 'aaji' : 'villager';
      g.talk.bark('greet', kid ? [[['villager', 'Mangalu! Do the langur call again!', 'a child, tugging your arm']], [['villager', 'Is the red dog really yours? Can I pat her?', 'a child']]]
        : who === 'aaji' ? [[['aaji', 'Mangalu. Have you eaten? You have not eaten.', 'she already has a bowl in her hand']], [['aaji', 'Sit. The forest will still be there after food.', 'patting the ground beside her']]]
          : [[['villager', "There's the forest boy. Ram-ram, Mangalu.", 'a nod']], [['villager', 'Sukhi says you talk to langurs. Is it true?', 'half laughing']], [['villager', 'Mind the buffalo, she kicks.', 'without looking up']]], { cd: 30 });
    });
    g.on('trusted', (e) => g.talk.bark('trusted-' + e.sp, [[['vanaj', pickOne(["It's letting me this close.", "It isn't afraid of me. Look at that.", 'Easy. I only want to say hello.'])]]], { cd: 120 }));
  }
  // who is with him, if anyone
  friend() { const c = this.g.companion; return c && !c.dead ? (c.name === 'Kaali' ? 'kaali' : 'chingari') : null; }
  sim(e) {
    const g = this.g, f = this.friend(), T = g.talk, W = g.world;
    if (g.story.entering || g.uiBlocking) return;
    // a scene of the story has the floor: nothing is said about the weather over it
    if ((W.quiet || W.tension > 0.4) && e.what !== 'see') return;
    if (e.what === 'danger' || e.what === 'safe') return;   // (the forest's own alarm and settling say this now)
    switch (e.what) {
      case 'forest':
        if (e.state === 'hush') T.bark('hush', f === 'kaali' ? [[['kaali', 'Listen. Nothing. When the forest says nothing, something is very close.', 'ears forward']]] : [[['vanaj', "It's gone quiet. Too quiet."]], [['vanaj', 'Not one bird. Something is close.']]], { cd: 90 });
        else if (e.state === 'afterRain') T.bark('after-rain', [[['vanaj', 'Listen to that. Everything singing at once.']]], { cd: 400 });
        else if (e.state === 'dawn' && e.from === 'night') T.bark('chorus', [[['vanaj', 'The junglefowl first. Then the barbets. Then everyone.']]], { cd: 900 });
        else if (e.from === 'settle') T.bark('settled', [[['vanaj', 'One bulbul. Then another. It has passed.']]], { cd: 200 });
        break;
      case 'see': if (FIRST[e.sp]) T.bark('see-' + e.sp, [FIRST[e.sp]], { once: true }); break;
      case 'rain-start':
        T.bark('rain', f === 'chingari' ? [[['chingari', 'Wet! Wet wet wet!', 'sneeze'], ['vanaj', "It's only rain, spark."]]] : f === 'kaali' ? [[['kaali', 'Rain. Good. It hides our smell.', 'nose up']]] : [[['vanaj', 'Here it comes.']], [['vanaj', 'Rain. The deer will go under the trees.']]], { cd: 200 });
        break;
      case 'rain-stop': T.bark('rain-stop', [[['vanaj', "It's stopped. Listen to the frogs."]], [['vanaj', 'Everything smells new.']]], { cd: 200 }); break;
      case 'night-fall':
        T.bark('night', f === 'chingari' ? [[['chingari', 'Dark! Stay close? Stay close.', 'whine'], ['vanaj', "I'm right here."]]] : f === 'kaali' ? [[['kaali', 'Night. The cats are waking. Keep near the fire.', 'low whuff']]] : [[['vanaj', 'Dark soon. A fire, or a tree.']], [['vanaj', 'Night. Everything with stripes or spots is waking up.']]], { cd: 300 });
        break;
      case 'day-break': T.bark('dawn', [[['vanaj', 'First light. The junglefowl are at it already.']], [['vanaj', 'Morning. The deer will be at the water.']]], { cd: 300 }); break;
      case 'danger':
        if (W.tension > 0.4) break;   // a scene of the story has its own words
        T.bark('danger', f === 'kaali' ? [[['kaali', 'Something with claws is near. Stay by me.', 'hackles up']]] : f === 'chingari' ? [[['chingari', 'Bad smell! Big bad smell!', 'growl']]] : [[['vanaj', "The birds have gone quiet. Something's hunting."]], [['vanaj', 'That was an alarm call. Careful now.']]], { cd: 90 });
        break;
      case 'safe': if (W.tension < 0.4) T.bark('safe', [[['vanaj', 'Gone. The mynas are talking again.']], [['vanaj', 'It has moved on.']]], { cd: 120 }); break;
      case 'fire': T.bark('fire', [[['vanaj', "Warm. That's better."]], [['vanaj', 'Nothing with claws likes a fire.']]], { cd: 240 }); break;
      case 'phase': if (e.phase === 'midday' && g.season === 'summer') T.bark('heat', [[['vanaj', 'Too hot to walk. Even the langurs have stopped.']], [['vanaj', 'Shade. Everything sensible is lying in the shade.']]], { cd: 400 }); break;
    }
  }
  update(dt) {
    const g = this.g, P = g.player, T = g.talk, W = g.world;
    this.t -= dt; this.idle -= dt;
    if (this.t > 0 || g.cinematic || g.uiBlocking || P.dead || g.story.entering) return;
    this.t = 4;
    if (W.quiet || W.tension > 0.4) { this.idle = Math.max(this.idle, 40); return; }
    if (P.hunger < 28) T.bark('hungry', [[['vanaj', "My belly's talking. Fruit, fish, anything."]], [['vanaj', 'I need to eat something.']]], { cd: 150 });
    else if (P.thirst < 28) T.bark('thirsty', [[['vanaj', 'Mouth like dry leaves. Water.']], [['vanaj', 'I need water.']]], { cd: 150 });
    else if (P.hp < 35) T.bark('hurt', [[['vanaj', 'That hurt. I should bind it and rest by a fire.']]], { cd: 150 });
    else if (W.cold > 0.6 && W.night > 0.5 && !W.fire) T.bark('cold', [[['vanaj', g.story.chIndex > 2 ? 'Cold. Kaali used to sleep across my feet.' : 'Cold. I want the fire.']]], { cd: 300 });
    // a quiet stretch with someone beside him
    if (this.idle <= 0 && W.danger < 0.2 && !T.busy) {
      this.idle = 90 + Math.random() * 80; const f = this.friend();
      if (f === 'kaali') T.bark('kaali-idle', [
        [['kaali', 'You walk like a gaur. Softer.', 'huff'], ['vanaj', 'I am being soft.'], ['kaali', 'A soft gaur, then.', 'huff']],
        [['kaali', 'When I was young I could outrun the rain.', 'sigh'], ['vanaj', 'You tell me that every winter.'], ['kaali', 'It is true every winter.', 'whuff']],
        [['vanaj', 'What do you smell?'], ['kaali', 'Chital, an hour old. Boar, older. You, always.', 'nose working']],
      ], { cd: 120 });
      else if (f === 'chingari') T.bark('pup-idle', [
        [['chingari', 'Smell! New smell! What is it?', 'yip'], ['vanaj', "That's a porcupine's hole. Leave it."]],
        [['chingari', 'Race? Race! Race now!', 'play bow'], ['vanaj', 'You always win.'], ['chingari', 'Yes!', 'yip']],
        [['chingari', 'Tired. Carry?', 'whine'], ['vanaj', 'You have four legs. I have two.']],
      ], { cd: 120 });
      else if (g.story.chIndex > 2 && g.story.chIndex < 8) T.bark('alone-idle', [
        [['vanaj', "Kaali would know what that track is. I'm guessing."]],
        [['vanaj', 'Talking to myself again. Nobody else to talk to.']],
        [['vanaj', 'Four notes. Where did I get four notes?']],
      ], { cd: 240 });
    }
  }
}

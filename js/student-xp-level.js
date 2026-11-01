(() => {
  "use strict";

  const LEVELS = [
    { number: 1, title: "Beginner", minXp: 0, icon: "fa-seedling", color: "green" },
    { number: 2, title: "Learner", minXp: 100, icon: "fa-book-open", color: "blue" },
    { number: 3, title: "Achiever", minXp: 300, icon: "fa-star", color: "gold" },
    { number: 4, title: "Scholar", minXp: 600, icon: "fa-graduation-cap", color: "purple" },
    { number: 5, title: "Expert", minXp: 1000, icon: "fa-gem", color: "cyan" },
    { number: 6, title: "Champion", minXp: 1500, icon: "fa-trophy", color: "gold" },
    { number: 7, title: "Master", minXp: 2500, icon: "fa-crown", color: "purple" },
    { number: 8, title: "Legend", minXp: 5000, icon: "fa-fire", color: "orange" },
  ];

  function getLevel(xp) {
    const currentXp = Number.isFinite(Number(xp)) ? Math.max(0, Number(xp)) : 0;
    let levelIndex = 0;
    for (let index = 1; index < LEVELS.length; index += 1) {
      if (currentXp < LEVELS[index].minXp) break;
      levelIndex = index;
    }

    const current = LEVELS[levelIndex];
    const next = LEVELS[levelIndex + 1] || null;
    const progress = next
      ? Math.max(0, Math.min(
        100,
        (currentXp - current.minXp) / (next.minXp - current.minXp) * 100,
      ))
      : 100;
    return {
      currentXp,
      current,
      next,
      progress,
      remaining: next ? Math.max(0, next.minXp - currentXp) : 0,
    };
  }

  window.StudentXpLevel = Object.freeze({ getLevel });
})();

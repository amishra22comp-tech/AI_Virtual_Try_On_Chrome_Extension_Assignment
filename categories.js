// Single source of truth for profile slots and product categories.
// To add a category later: add one object to `categories`. No extension rebuild needed.
const slots = {
  front: { label: "Front full-body", tip: "Stand straight, head to toe in frame, arms slightly away from body, plain background, daylight, fitted clothes." },
  upper: { label: "Upper body", tip: "Chest-up, facing the camera, both shoulders and neck visible." },
  legs:  { label: "Legs / lower body", tip: "Waist to feet, straight on, fitted clothing." },
  feet:  { label: "Feet / shoes", tip: "Shoot from above and slightly in front, feet shoulder-width apart on a plain floor." },
  face:  { label: "Face", tip: "Face the camera, neutral expression, no sunglasses, even lighting." },
};

// Order matters for keyword guessing (more specific first).
const categories = [
  { id: "necklace", label: "Necklace", slots: ["face", "upper"], keywords: ["necklace", "pendant", "choker", "chain"],
    instruction: "Place the necklace naturally around the person's neck, resting on the collarbone with correct scale and drape." },
  { id: "jewellery", label: "Jewellery", slots: ["face", "upper"], keywords: ["earring", "ring", "bracelet", "bangle", "jewel", "jewelry", "anklet"],
    instruction: "Place the jewellery piece on the correct body part (ears, finger, wrist, etc.) at realistic scale." },
  { id: "shoes", label: "Shoes", slots: ["feet", "front"], keywords: ["shoe", "sneaker", "boot", "sandal", "loafer", "heel", "slipper", "footwear"],
    instruction: "Put the shoes on the person's feet with correct perspective, scale, and ground contact shadows." },
  { id: "dress", label: "Dress", slots: ["front", "face"], keywords: ["dress", "gown", "kurti", "saree", "sari", "lehenga", "frock"],
    instruction: "Dress the person in this dress with realistic fit, length, drape and positioning." },
  { id: "jacket", label: "Jacket", slots: ["front", "upper"], keywords: ["jacket", "coat", "blazer", "hoodie", "sweatshirt", "cardigan", "sweater"],
    instruction: "Dress the person in this jacket/outerwear with natural fit, collar, sleeves and layering." },
  { id: "pants", label: "Pants / trousers", slots: ["front", "legs"], keywords: ["pant", "trouser", "jeans", "jogger", "shorts", "skirt", "legging"],
    instruction: "Dress the person in these bottoms with correct waist, length and fit." },
  { id: "tshirt", label: "T-shirt / top", slots: ["front", "upper"], keywords: ["t-shirt", "tshirt", "tee", "top", "tank", "polo", "crop"],
    instruction: "Dress the person in this t-shirt/top so it sits naturally on their upper body." },
  { id: "shirt", label: "Shirt", slots: ["front", "upper"], keywords: ["shirt", "blouse", "kurta"],
    instruction: "Dress the person in this shirt with natural collar, buttons, sleeves and fit." },
  { id: "accessory", label: "Accessory", slots: ["front", "face"], keywords: ["watch", "bag", "belt", "cap", "hat", "scarf", "sunglass", "glasses", "tie", "wallet"],
    instruction: "Place this accessory on the person where it would normally be worn or carried, at realistic scale." },
];

module.exports = { slots, categories };

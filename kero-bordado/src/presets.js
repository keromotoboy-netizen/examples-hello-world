// Bastidor da Brother PE-560L: 100 x 100 mm. Usamos 95 mm de área útil (folga de segurança).
export const HOOP = { w: 100, h: 100, usable: 95 };

export const FABRICS = {
  toalha: {
    label: "Toalha felpuda",
    params: { density: 0.38, fillStitch: 3.5, maxStitch: 7, underlaySpacing: 1.8, underlayInset: 0.35, pullComp: 0.2, edgeRun: true, satin: true, satinMax: 5.0, satinSpacing: 0.42, satinComp: 0.15 },
    minLetterMm: 8,
    tips: [
      "Entretela hidrossolúvel (tipo plástico) POR CIMA do pelo — sem ela o pelo engole o bordado.",
      "Entretela de rasgar (tear-away) ou de cortar (cut-away) por baixo.",
      "Agulha de bordar 75/11 (ou 90/14 se a toalha for bem grossa).",
      "Depois de bordar, retire o excesso do plástico e borrife água para dissolver o resto.",
      "Para nomes em toalha, prefira letras de pelo menos 2,5 cm e fontes mais grossas (Pacifico, Fredoka, Lobster): detalhes finos somem no pelo.",
    ],
  },
  malha: {
    label: "Malha / camiseta / body",
    params: { density: 0.45, fillStitch: 3.5, maxStitch: 7, underlaySpacing: 2.2, underlayInset: 0.4, pullComp: 0.3, edgeRun: false, satin: true, satinMax: 7.0, satinSpacing: 0.5, satinComp: 0.2 },
    minLetterMm: 5,
    tips: [
      "Entretela de cortar (cut-away) por baixo — malha estica e a de rasgar não segura.",
      "Agulha ponta bola 75/11.",
      "Não estique a malha ao prender no bastidor: deixe firme, mas sem deformar.",
    ],
  },
  algodao: {
    label: "Algodão / tricoline / pano de prato",
    params: { density: 0.42, fillStitch: 4.0, maxStitch: 7, underlaySpacing: 2.5, underlayInset: 0.4, pullComp: 0.15, edgeRun: false, satin: true, satinMax: 7.0, satinSpacing: 0.45, satinComp: 0.15 },
    minLetterMm: 5,
    tips: ["Entretela de rasgar (tear-away) por baixo.", "Agulha de bordar 75/11.", "Tecido bem esticado no bastidor, como pele de tambor."],
  },
  jeans: {
    label: "Jeans / brim / lona",
    params: { density: 0.40, fillStitch: 4.0, maxStitch: 7, underlaySpacing: 2.2, underlayInset: 0.4, pullComp: 0.15, edgeRun: false, satin: true, satinMax: 7.0, satinSpacing: 0.45, satinComp: 0.15 },
    minLetterMm: 6,
    tips: ["Entretela de rasgar (tear-away) média por baixo.", "Agulha 90/14.", "Vá devagar nas costuras grossas: evite bordar em cima delas."],
  },
  feltro: {
    label: "Feltro / flanela / moletom",
    params: { density: 0.42, fillStitch: 3.5, maxStitch: 7, underlaySpacing: 2.0, underlayInset: 0.35, pullComp: 0.2, edgeRun: true, satin: true, satinMax: 6.5, satinSpacing: 0.45, satinComp: 0.2 },
    minLetterMm: 7,
    tips: ["Moletom e flanela: hidrossolúvel por cima ajuda a não afundar.", "Entretela de cortar (cut-away) por baixo.", "Agulha 75/11."],
  },
};

export const PIECES = {
  toalha_rosto: { label: "Toalha de rosto", fabric: "toalha", widthCm: 9, letterCm: 2.5, place: "Centralizado na largura, 5 a 7 cm acima da barra (faixa lisa)." },
  toalha_mao: { label: "Toalha de mão / lavabo", fabric: "toalha", widthCm: 8, letterCm: 2.0, place: "Centralizado, 4 a 5 cm acima da barra." },
  toalha_banho: { label: "Toalha de banho", fabric: "toalha", widthCm: 30, letterCm: 5, place: "Centralizado na largura, em cima da barra ou 8 a 10 cm acima dela." },
  roupao: { label: "Roupão (peito)", fabric: "toalha", widthCm: 9, letterCm: 2.5, place: "Peito esquerdo, uns 20 cm abaixo do ombro." },
  camiseta: { label: "Camiseta (peito)", fabric: "malha", widthCm: 8, letterCm: 2.0, place: "Peito esquerdo: 18 a 20 cm abaixo do ombro e 9 a 10 cm do centro." },
  body: { label: "Body / fralda de bebê", fabric: "malha", widthCm: 8, letterCm: 2.0, place: "Centralizado, a uns 5 cm da borda." },
  pano_prato: { label: "Pano de prato", fabric: "algodao", widthCm: 9, letterCm: 3, place: "Centralizado, 5 a 8 cm acima da barra." },
  jeans: { label: "Jeans / bolsa de lona", fabric: "jeans", widthCm: 9, letterCm: 3, place: "Escolha uma área lisa, longe das costuras." },
  outro: { label: "Outra peça", fabric: "algodao", widthCm: 9, letterCm: 3, place: "Marque o centro com caneta hidrossolúvel." },
};

export const FONTS = [
  { family: "Great Vibes", label: "Cursiva elegante" },
  { family: "Dancing Script", label: "Cursiva leve", weight: 700 },
  { family: "Pacifico", label: "Cursiva grossa" },
  { family: "Lobster", label: "Cursiva retrô" },
  { family: "Satisfy", label: "Cursiva fina" },
  { family: "Fredoka", label: "Arredondada (infantil)", weight: 700 },
  { family: "Baloo 2", label: "Divertida (infantil)", weight: 800 },
  { family: "Anton", label: "Bastão alta" },
  { family: "Montserrat", label: "Bastão moderna", weight: 800 },
  { family: "Playfair Display", label: "Serifada clássica", weight: 700 },
];

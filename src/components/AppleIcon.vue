<script setup lang="ts">
const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 24 });

const paths: Record<string, string[]> = {
  calendar: ['M7 2v3M17 2v3M3.5 9h17M5 4h14a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 19 21H5a1.5 1.5 0 0 1-1.5-1.5v-14A1.5 1.5 0 0 1 5 4Z'],
  award: ['M12 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z', 'm8.5 14.5-1 7 4.5-2 4.5 2-1-7'],
  bookmark: ['M6 3.5h12v18l-6-3.5-6 3.5v-18Z'],
  star: ['m12 3 1.8 7.2L21 12l-7.2 1.8L12 21l-1.8-7.2L3 12l7.2-1.8L12 3Z'],
  sparkles: ['m12 2 1.15 4.35L17.5 7.5l-4.35 1.15L12 13l-1.15-4.35L6.5 7.5l4.35-1.15L12 2Z', 'm19 14 .65 2.35L22 17l-2.35.65L19 20l-.65-2.35L16 17l2.35-.65L19 14Z', 'm5 13 .8 3.2L9 17l-3.2.8L5 21l-.8-3.2L1 17l3.2-.8L5 13Z'],
  book: ['M4 4.5h5.5A2.5 2.5 0 0 1 12 7v13a2.5 2.5 0 0 0-2.5-2.5H4v-13Z', 'M20 4.5h-5.5A2.5 2.5 0 0 0 12 7v13a2.5 2.5 0 0 1 2.5-2.5H20v-13Z'],
  user: ['M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z', 'M4 21a8 8 0 0 1 16 0'],
  bell: ['M5 17h14l-1.5-2v-4.5a5.5 5.5 0 0 0-11 0V15L5 17Z', 'M10 20h4'],
  alarm: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 8v5l3 2', 'M5 3 2.5 2M19 3l-2.5 2'],
  moon: ['M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z'],
  microphone: ['M12 15.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v6a3.5 3.5 0 0 0 3.5 3.5Z', 'M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v4M8.5 22h7'],
  history: ['M3.5 12a8.5 8.5 0 1 0 2.2-5.7', 'M3.5 4.5v4h4', 'M12 7.5V12l3 2'],
  droplet: ['M12 2.5S5.5 10 5.5 15a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5Z'],
  cloudSun: ['M15.5 8.5a4 4 0 0 0-7.7 1.4A4.5 4.5 0 0 0 8.5 19H18a3.5 3.5 0 0 0 .5-7', 'M16 2v2M21 7h-2M19.5 3.5 18 5'],
  archive: ['M4 8h16v12H4V8Z', 'M3 4h18v4H3V4Z', 'M9 12h6'],
  school: ['m3 10 9-6 9 6-9 6-9-6Z', 'M5 10v9M9.5 10v9M14.5 10v9M19 10v9M3 20h18'],
  document: ['M6 2.5h8l4 4V21H6V2.5Z', 'M14 2.5v4h4', 'M9 12h6M9 16h6'],
  heartPulse: ['M20.8 5.7a5.2 5.2 0 0 0-7.4 0L12 7.1l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 22l8.8-8.9a5.2 5.2 0 0 0 0-7.4Z', 'M4.5 12h4l1.5-3 3 6 1.5-3h5'],
  key: ['M14 8a5 5 0 1 0-4.7 6.7L4 20v2h3v-2h2v-2h2l2-2A5 5 0 0 0 14 8Z', 'M16.5 7.5h.01'],
  link: ['M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1', 'M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1'],
  handHeart: ['M7 11V8.5a1.5 1.5 0 0 1 3 0V11', 'M10 11V7.5a1.5 1.5 0 0 1 3 0V11', 'M13 11V8.5a1.5 1.5 0 0 1 3 0v4.8c0 3.8-2.3 6.2-6 7.2l-1 .3-5.5-6.1a1.8 1.8 0 0 1 2.6-2.5L8 14'],
  broom: ['m15 3 6 6', 'M17.5 6.5 11 13', 'M11 13c-3-1-6 .2-8 3.5 3.2 3.1 7.3 4 11.5 2.5L11 13Z'],
  compass: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm15.5 8.5-2 5-5 2 2-5 5-2Z'],
  creditCard: ['M3 6h18v12H3V6Z', 'M3 10h18', 'M7 15h3'],
  bus: ['M5 17V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v11', 'M5 12h14M7 17h10', 'M7 21v-2M17 21v-2'],
  home: ['m3 11 9-8 9 8', 'M5 10v11h14V10', 'M9 21v-7h6v7'],
  briefcase: ['M4 7h16v13H4V7Z', 'M9 7V4h6v3', 'M4 12h16'],
  target: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z'],
  chart: ['M4 20V10M10 20V4M16 20v-7M22 20H2'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 10v6', 'M12 7h.01'],
  chevronRight: ['m9 5 7 7-7 7']
};
</script>

<template>
  <svg
    class="apple-icon"
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="path in (paths[props.name] || paths.info)" :key="path" :d="path" />
  </svg>
</template>

<style scoped>
.apple-icon { display: block; flex: none; }
</style>

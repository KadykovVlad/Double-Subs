import { describe, expect, it } from 'vitest';
import { fileLabel, loadSubtitleFiles, parseSubtitleFile } from '../src/lib/subtitle-files';

describe('parseSubtitleFile', () => {
  it('reads WebVTT: header, notes, identifiers, settings and hours', () => {
    const cues = parseSubtitleFile(
      [
        'WEBVTT',
        '',
        'NOTE a comment',
        'with --> inside',
        '',
        'intro',
        '00:00:01.000 --> 00:00:03.500 align:start',
        'Hello,',
        'Dexter.',
        '',
        '1:02:03.040 --> 1:02:05.000',
        '<i>Late</i>',
      ].join('\n'),
    );
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: 'Hello,\nDexter.' },
      { start: 3723.04, end: 3725, text: '<i>Late</i>' },
    ]);
  });

  it('reads SubRip with comma milliseconds, Windows line ends and a BOM', () => {
    const cues = parseSubtitleFile(
      '﻿1\r\n00:00:01,500 --> 00:00:02,000\r\nOne\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,25\r\nTwo\r\n',
    );
    expect(cues).toEqual([
      { start: 1.5, end: 2, text: 'One' },
      { start: 3, end: 4.25, text: 'Two' },
    ]);
  });

  it('skips blocks with no text and anything that is not a subtitle file', () => {
    expect(parseSubtitleFile('00:00:01.000 --> 00:00:02.000\n')).toEqual([]);
    expect(parseSubtitleFile('<html><body>Not found</body></html>')).toEqual([]);
    expect(parseSubtitleFile('')).toEqual([]);
  });
});

describe('loadSubtitleFiles', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi there\n';
  const answer = (body: string, ok = true) =>
    Promise.resolve({ ok, text: () => Promise.resolve(body) });

  it('returns the files that could be read and drops the rest', async () => {
    const fake = ((url: string) => {
      if (url.endsWith('a.vtt')) return answer(vtt);
      if (url.endsWith('b.vtt')) return answer('', false);
      if (url.endsWith('c.vtt')) return answer('<html>login</html>');
      return Promise.reject(new Error('CORS'));
    }) as unknown as typeof fetch;
    const files = await loadSubtitleFiles(
      ['https://x/a.vtt', 'https://x/b.vtt', 'https://x/c.vtt', 'https://x/d.vtt'],
      fake,
    );
    expect(files).toEqual([
      { url: 'https://x/a.vtt', cues: [{ start: 1, end: 2, text: 'Hi there' }] },
    ]);
  });

  it('refuses a huge answer', async () => {
    const fake = (() => answer('x'.repeat(2_000_001))) as unknown as typeof fetch;
    expect(await loadSubtitleFiles(['https://x/a.vtt'], fake)).toEqual([]);
  });
});

describe('fileLabel', () => {
  it('is the file name without the query', () => {
    expect(fileLabel('https://cdn.x/1/sub_eng-3.vtt?t=abc')).toBe('sub_eng-3.vtt');
  });
});

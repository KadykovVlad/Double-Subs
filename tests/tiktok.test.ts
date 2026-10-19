import { describe, expect, it } from 'vitest';
import { idOfPath, idOfWrapper, isTikTokHost, isTikTokPattern, itemsOf } from '../src/lib/tiktok';

const caption = (url: string, language = 'eng-US') => ({
  Url: url,
  LanguageCodeName: language,
  Source: 'ASR',
  Format: 'webvtt',
});

describe('TikTok data', () => {
  it('finds every video of a feed answer with its subtitle files, and the ones that have none', () => {
    const answer = {
      itemList: [
        {
          id: '7685187890472602887',
          desc: 'a',
          video: { subtitleInfos: [caption('https://v16.tiktok.com/a')] },
        },
        { id: '7696118350623083794', desc: 'b', video: { claInfo: { noCaptionReason: 3 } } },
      ],
    };
    expect(itemsOf(answer)).toEqual([
      {
        id: '7685187890472602887',
        captions: [{ url: 'https://v16.tiktok.com/a', language: 'eng-US', source: 'ASR' }],
      },
      { id: '7696118350623083794', captions: [] },
    ]);
  });

  it("reads the page's own data, and the same address given twice (subtitleInfos and claInfo) once", () => {
    const page = {
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          itemInfo: {
            itemStruct: {
              id: '7696118350623083794',
              video: {
                subtitleInfos: [caption('https://v16.tiktok.com/r', 'rus-RU')],
                claInfo: {
                  captionInfos: [
                    {
                      url: 'https://v16.tiktok.com/r',
                      language: 'rus-RU',
                      isAutoGen: true,
                      captionFormat: 'webvtt',
                    },
                  ],
                },
              },
            },
          },
        },
      },
    };
    expect(itemsOf(page)).toEqual([
      {
        id: '7696118350623083794',
        captions: [{ url: 'https://v16.tiktok.com/r', language: 'rus-RU', source: 'ASR' }],
      },
    ]);
  });

  it('takes only WebVTT files on https', () => {
    const item = (subtitleInfos: unknown[]) => ({
      itemList: [{ id: '1234567', video: { subtitleInfos } }],
    });
    expect(itemsOf(item([{ ...caption('http://evil.example/x') }]))[0]!.captions).toEqual([]);
    expect(
      itemsOf(item([{ ...caption('https://v16.tiktok.com/x'), Format: 'srt' }]))[0]!.captions,
    ).toEqual([]);
    expect(itemsOf(item([{ Url: 42 }]))[0]!.captions).toEqual([]);
  });

  it('knows the video of a player and of a page address', () => {
    expect(idOfWrapper('xgwrapper-0-7685187890472602887')).toBe('7685187890472602887');
    expect(idOfWrapper('xgwrapper-0-')).toBeNull();
    expect(idOfWrapper('something-else')).toBeNull();
    expect(idOfPath('/@lane.rbf/video/7696118350623083794')).toBe('7696118350623083794');
    expect(idOfPath('/foryou')).toBeNull();
  });

  it('knows TikTok by its addresses', () => {
    expect(isTikTokHost('www.tiktok.com')).toBe(true);
    expect(isTikTokHost('tiktok.com')).toBe(true);
    expect(isTikTokHost('nottiktok.com')).toBe(false);
    expect(isTikTokHost('tiktok.com.evil.example')).toBe(false);
    expect(isTikTokPattern('https://www.tiktok.com/*')).toBe(true);
    expect(isTikTokPattern('*://*.tiktok.com/*')).toBe(true);
    expect(isTikTokPattern('https://www.youtube.com/*')).toBe(false);
  });
});

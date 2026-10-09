import { describe, expect, it } from 'vitest';
import { brandOf, isIpHost, matchKnownHost } from '../src/lib/site-match';

describe('brandOf', () => {
  it('takes the name of the site without digits, subdomains and the top-level domain', () => {
    expect(brandOf('ga.lordfilm5.pro')).toBe('lordfilm');
    expect(brandOf('www.lordfilm.cc')).toBe('lordfilm');
    expect(brandOf('lordfilm-2.tv')).toBe('lordfilm');
    expect(brandOf('www.youtube.com')).toBe('youtube');
  });
  it('understands two-part endings like co.uk', () => {
    expect(brandOf('player.moviesite.co.uk')).toBe('moviesite');
  });
  it('has no name for numbers, local hosts and short names', () => {
    expect(brandOf('192.168.0.5')).toBeNull();
    expect(brandOf('localhost')).toBeNull();
    expect(brandOf('vk.com')).toBeNull();
    expect(brandOf('[::1]')).toBeNull();
  });
});

describe('matchKnownHost', () => {
  const known = ['ga.lordfilm5.pro', 'www.youtube.com', '10.0.0.7'];

  it('knows the exact address', () => {
    expect(matchKnownHost('ga.lordfilm5.pro', known)).toBe(true);
    expect(matchKnownHost('10.0.0.7', known)).toBe(true);
  });
  it('knows a mirror by the name that stays in the address', () => {
    expect(matchKnownHost('lordfilm7.cc', known)).toBe(true);
    expect(matchKnownHost('new-lordfilm.org', known)).toBe(true);
    expect(matchKnownHost('player.lordfilm-hd.tv', known)).toBe(true);
    expect(matchKnownHost('m.youtube.com', known)).toBe(true);
  });
  it('does not know other sites, nor other numbers', () => {
    expect(matchKnownHost('example.org', known)).toBe(false);
    expect(matchKnownHost('rutube.ru', known)).toBe(false);
    expect(matchKnownHost('10.0.0.8', known)).toBe(false);
    expect(matchKnownHost('lord.film', known)).toBe(false);
  });
  it('a number never matches by name', () => {
    expect(matchKnownHost('127.0.0.1', ['lordfilm5.pro'])).toBe(false);
  });
  it('isIpHost', () => {
    expect(isIpHost('1.2.3.4')).toBe(true);
    expect(isIpHost('a.b.c')).toBe(false);
  });
});

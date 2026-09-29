// Builds a feed in the shape YouTube serves at /feeds/videos.xml, from made-up videos.
export interface TestVideo {
  readonly id: string;
  readonly title: string;
  readonly published: string;
}

export function buildFeed(videos: readonly TestVideo[]): string {
  const entries = videos.map(
    (video) => `
 <entry>
  <id>yt:video:${video.id}</id>
  <yt:videoId>${video.id}</yt:videoId>
  <yt:channelId>UC0000000000000000000000</yt:channelId>
  <title>${video.title}</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=${video.id}"/>
  <author>
   <name>Made-up Channel</name>
   <uri>https://www.youtube.com/channel/UC0000000000000000000000</uri>
  </author>
  <published>${video.published}</published>
  <updated>${video.published}</updated>
  <media:group>
   <media:title>${video.title}</media:title>
   <media:content url="https://www.youtube.com/v/${video.id}?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:community>
    <media:statistics views="42"/>
   </media:community>
  </media:group>
 </entry>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=UC0000000000000000000000"/>
 <id>yt:channel:0000000000000000000000</id>
 <yt:channelId>0000000000000000000000</yt:channelId>
 <title>Made-up Channel</title>
 <link rel="alternate" href="https://www.youtube.com/channel/UC0000000000000000000000"/>
 <published>2019-01-01T00:00:00+00:00</published>${entries.join("")}
</feed>
`;
}

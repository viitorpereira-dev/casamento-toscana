// Keep existing photo paths in the travel album; new story photos use a folder.
export const albumForPhoto = (photo) => photo.storage_path.startsWith('story/') ? 'story' : 'travel';
export const albumFilter = (album) => album === 'story'
  ? '&storage_path=like.story/*'
  : '&storage_path=not.like.story/*';
export const requestAlbum = (request) => {
  const album = new URL(request.url).searchParams.get('album') ?? 'travel';
  if (album !== 'travel' && album !== 'story') throw new Response('Album invalido.', { status: 422 });
  return album;
};

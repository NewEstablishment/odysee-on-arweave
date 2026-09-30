import React from 'react';
import classnames from 'classnames';
import SectionList from 'component/channelSections/SectionList';
import ChannelThumbnail from 'component/channelThumbnail';
import Gerbil from 'component/channelThumbnail/gerbil.png';
import { Tab, TabList, TabPanel, TabPanels, Tabs } from 'component/common/tabs';
import ThumbnailBrokenImage from 'component/selectThumbnail/thumbnail-broken.png';
import { parseURI } from 'util/lbryURI';
import { useAppSelector } from 'redux/hooks';
import { makeSelectCoverForUri, selectClaimForUri } from 'redux/selectors/claims';
import { getClaimTitle, getThumbnailFromClaim } from 'util/claim';
import { CARD_CLASSES } from 'component/common/card-classes';
import { CHANNEL_COVER_CLASSES } from 'component/channelCover/classes';
import { CHANNEL_THUMBNAIL_CLASSES } from 'component/channelThumbnail/classes';
import { CHANNEL_PAGE_CLASSES } from 'page/claim/internal/claimPageComponent/internal/channelPage/classes';

type Props = {
  uri: string;
  disabled?: boolean;
};
export default function ChannelSectionsEdit(props: Props) {
  const { uri, disabled } = props;

  const claim = useAppSelector((state) => selectClaimForUri(state, uri));
  const title = getClaimTitle(claim);
  const thumbnailUrl = getThumbnailFromClaim(claim) as string | undefined;
  const coverUrl = useAppSelector((state) => makeSelectCoverForUri(uri)(state));
  // @todo: anything need to handle with 'creatingChannel' and 'updatingChannel' (i.e. while channel is being created)
  const [coverError, setCoverError] = React.useState(false);
  const [thumbError, setThumbError] = React.useState(false);
  const { channelName } = parseURI(uri);
  const coverSrc = coverError ? ThumbnailBrokenImage : coverUrl;
  const thumbnailPreview = resolveThumbnailPreview();

  function resolveThumbnailPreview() {
    if (!thumbnailUrl) {
      return Gerbil;
    } else if (thumbError) {
      return ThumbnailBrokenImage;
    } else {
      return thumbnailUrl;
    }
  }

  return (
    <div
      className={classnames({
        [CARD_CLASSES.disabled]: disabled,
      })}
    >
      <header className={CHANNEL_COVER_CLASSES.root}>
        {coverUrl &&
          (coverError ? (
            <div className={CHANNEL_COVER_CLASSES.waiting}>
              <p>{__('Uploaded image will be visible in a few minutes after you submit this form.')}</p>
            </div>
          ) : (
            <img className={CHANNEL_COVER_CLASSES.custom} src={coverSrc} onError={() => setCoverError(true)} />
          ))}
        <div className={CHANNEL_COVER_CLASSES.primaryInfo}>
          <ChannelThumbnail
            className={CHANNEL_THUMBNAIL_CLASSES.channelPage}
            uri={uri}
            thumbnailPreview={thumbnailPreview}
            allowGifs
            setThumbUploadError={setThumbError}
            thumbUploadError={thumbError}
          />
          <h1 className={CHANNEL_COVER_CLASSES.title}>{title || (channelName && '@' + channelName)}</h1>
        </div>
      </header>

      <Tabs className="channelPage-wrapper">
        <TabList className={CHANNEL_PAGE_CLASSES.tabList}>
          <Tab>{''}</Tab>
        </TabList>
        <TabPanels panelClassName={CHANNEL_PAGE_CLASSES.tabPanel}>
          <TabPanel>
            <SectionList uri={uri} editMode />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
  );
}

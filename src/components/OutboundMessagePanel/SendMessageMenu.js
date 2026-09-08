import {
  MenuButton,
  MenuItem,
  Menu,
  MenuSeparator,
  useMenuState,
} from "@twilio-paste/core/menu";
import { ChevronDownIcon } from "@twilio-paste/icons/esm/ChevronDownIcon";

const SendMessageMenu = (props) => {
  const menu = useMenuState();
  return (
    <>
      <MenuButton
        {...menu}
        variant="primary"
        disabled={props.disableSend}
        fullWidth
      >
        Send message <ChevronDownIcon decorative />
      </MenuButton>
      <Menu {...menu} aria-label="Send options">
        <MenuItem {...menu} onClick={() => props.onClickHandler("OPEN_CHAT")}>
          Send & open chat now
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          {...menu}
          onClick={() => props.onClickHandler("SEND_MESSAGE_REPLY_ME")}
        >
          Send & route reply to me
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          {...menu}
          onClick={() => props.onClickHandler("SEND_MESSAGE")}
        >
          Send & route reply to any agent
        </MenuItem>
      </Menu>
    </>
  );
};

export default SendMessageMenu;

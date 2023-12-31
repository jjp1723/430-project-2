const models = require('../models');

const { Account } = models;

// The maximum storage available to standard and premium accounts (16MB and 128MB)
const MAX_STANDARD_STORAGE = 16000000;
const MAX_PREMIUM_STORAGE = 128000000;

// Render functions for the login and account pages
const loginPage = (req, res) => res.render('login');
const accountPage = (req, res) => res.render('account');

// logout Function - Destroys the current session and redirects to the login page
const logout = (req, res) => {
  req.session.destroy();
  res.redirect('/');
};

// login Function - Handles requests to '/login'
const login = (req, res) => {
  // Get the values of the provided username and password
  const username = `${req.body.username}`;
  const pass = `${req.body.pass}`;

  // Ensure the values provided are not NULL
  if (!username || !pass) {
    return res.status(400).json({ error: 'All fields are required!' });
  }

  // Authenticating the provided values with existing accounts and redirecting to the main app page
  return Account.authenticate(username, pass, (err, account) => {
    if (err || !account) {
      return res.status(401).json({ error: 'Wrong username or password!' });
    }
    req.session.account = Account.toAPI(account);
    return res.json({ redirect: '/maker' });
  });
};

// signup Function - Handles calls to '/signup'
const signup = async (req, res) => {
  // Get the values of the provided username and passwords
  const username = `${req.body.username}`;
  const pass = `${req.body.pass}`;
  const pass2 = `${req.body.pass2}`;

  // Ensure the values provided are not NULL
  if (!username || !pass || !pass2) {
    return res.status(400).json({ error: 'All fields are required!' });
  }

  // Ensure the provided passwords match
  if (pass !== pass2) {
    return res.status(400).json({ error: 'Passwords do not match!' });
  }

  // Creating a new account with the provided username and password and redirecting to the app page
  try {
    const hash = await Account.generateHash(pass);
    const newAccount = new Account({ username, password: hash });
    await newAccount.save();
    req.session.account = Account.toAPI(newAccount);
    return res.json({ redirect: '/maker' });
  } catch (err) {
    console.log(err);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Username already in use!' });
    }
    return res.status(500).json({ error: 'An error has occured!' });
  }
};

// change Function - Handles calls to '/change'
const change = async (req, res) => {
  // Get the values of the provided old and new passwords
  const passOld = `${req.body.passwordOld}`;
  const passNew1 = `${req.body.passwordNew1}`;
  const passNew2 = `${req.body.passwordNew2}`;

  // Ensure the values provided are not NULL
  if (!passOld || !passNew1 || !passNew2) {
    return res.status(400).json({ error: 'All fields are required!' });
  }

  // Ensure the provided new passwords match
  if (passNew1 !== passNew2) {
    return res.status(400).json({ error: 'Passwords do not match!' });
  }

  // Update the password associated with the user currently logged in
  try {
    return Account.authenticate(req.session.account.username, passOld, async (err, account) => {
      // Ensure the provided old password matches the current password
      if (err || !account) {
        return res.status(401).json({ error: 'Old password is not correct!' });
      }

      const hash = await Account.generateHash(passNew1);
      await Account.findOneAndUpdate({ _id: req.session.account._id }, { password: hash });

      return res.status(201).json({ redirect: '/account', message: 'Password Change Successful' });
    });
  } catch (err) {
    console.log(err);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Password already in use!' });
    }
    return res.status(500).json({ error: 'An error has occured!' });
  }
};

// premium Function - Handles calls to '/premium'
const premium = async (req, res) => {
  // Get the value provided for whether to enable premium benefits
  const activate = `${req.body.enablePremium}`;

  // Ensure the value provided isn't null (not sure if this is even possible)
  if (!activate) {
    return res.status(400).json({ error: 'How did this happen!?' });
  }

  // Toggle the 'premium' status of the current user account
  try {
    await Account.findOneAndUpdate({ _id: req.session.account._id }, { premium: activate });
    return res.status(201).json({ message: 'Premium status toggled' });
  } catch (err) {
    console.log(err);
    if (err.code === 11000) {
      return res.status(400).json({ error: `Premium status already set to ${activate}!` });
    }
    return res.status(500).json({ error: 'An error has occured!' });
  }
};

// getUsers Function - Returns a list of all users currently registered with the site
const getUsers = async (req, res) => {
  try {
    const users = await Account.find({}).select('_id username').lean().exec();
    return res.json({ users });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Error changing visibility' });
  }
};

// deleteAccount Function - Deletes the current user's account
const deleteAccount = async (req, res) => {
  try {
    await Account.findByIdAndDelete({ _id: req.session.account._id });
    req.session.destroy();
    return res.json({ redirect: '/' });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Error deleting account!' });
  }
};

// getStorage Function - Returns the total storage used by the current user
const getStorage = async (req, res) => {
  try {
    const docs = await Account.findById({ _id: req.session.account._id }).select('premium storage').lean().exec();

    return res.json({ user: docs });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Error updating uploaded media total' });
  }
};

// increaseStorage Function - Increases the total storage used by the current user
//  when a new file is uploaded
const increaseStorage = async (req, res) => {
  // Getting the provided size of the new file to be uploaded
  const { size } = req.body;

  try {
    // Getting the current amount of storage the user has used
    const docs = await Account.findById({ _id: req.session.account._id }).select('premium storage').lean().exec();

    // Checking if the user has a premium account, and if so, if they will surpassed the limit
    if (docs.premium && docs.storage + size >= MAX_PREMIUM_STORAGE) {
      return res.status(400).json({ error: 'Out of storage!' });
    }
    // If the user has a standard account, checks if they will surpassed the limit
    if (docs.storage + size >= MAX_STANDARD_STORAGE) {
      return res.status(400).json({ error: 'Out of storage! Consider upgrading to premium!' });
    }

    // Updating the storage used by the user if uploading the new file will not surpass the limit
    await Account.findByIdAndUpdate(
      { _id: req.session.account._id },
      { storage: docs.storage + size },
    );

    return res.status(201).json({ message: 'Storage updated' });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Error updating used storage total' });
  }
};

// decreaseStorage Function - Decreases the total storage used by the current user
//  when an uploaded file is deleted
const decreaseStorage = async (req, res) => {
  // Getting the provided size of the existing file to be deleted
  const { size } = req.body;

  try {
    // Getting the current amount of storage the user has used
    const docs = await Account.findById({ _id: req.session.account._id }).select('premium storage').lean().exec();

    // Updating the storage used by the user
    await Account.findByIdAndUpdate(
      { _id: req.session.account._id },
      { storage: docs.storage - size },
    );

    return res.status(201).json({ message: 'Storage updated' });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Error updating uploaded media total' });
  }
};

module.exports = {
  loginPage,
  login,
  logout,
  signup,
  change,
  premium,
  accountPage,
  getUsers,
  deleteAccount,
  getStorage,
  increaseStorage,
  decreaseStorage,
};
